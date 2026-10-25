import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection, Keypair, Transaction } from '@solana/web3.js';
import { getAccount, getMint, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { amountUnits, DEVNET_GENESIS, MEMO_PROGRAM, payUsdc, prepareUsdc, settleUsdc, USDC_MINT, validatePayment, verifyPayment, type SignedPayment } from './solana';

vi.mock('@solana/spl-token', async () => ({ ...await vi.importActual<typeof import('@solana/spl-token')>('@solana/spl-token'), getAccount: vi.fn(), getMint: vi.fn() }));
const signer = Keypair.generate();
const request = { network: 'solana-devnet' as const, to: Keypair.generate().publicKey.toBase58(), amountUsdc: '0.123456', memo: '  exact memo: µL / task-7\n' };
function rpc() {
  const fake = { getGenesisHash: vi.fn().mockResolvedValue(DEVNET_GENESIS), getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1000 }),
    getFeeForMessage: vi.fn().mockResolvedValue({ value: 5000 }), getAccountInfo: vi.fn().mockResolvedValue(null), getMinimumBalanceForRentExemption: vi.fn().mockResolvedValue(2039280), getBalance: vi.fn().mockResolvedValue(1_000_000_000),
    getSignatureStatuses: vi.fn().mockResolvedValue({ value: [null] }), getBlockHeight: vi.fn().mockResolvedValue(500), getParsedTransaction: vi.fn(), sendRawTransaction: vi.fn() };
  return { fake, connection: fake as unknown as Connection };
}
function chainRecord(payment: SignedPayment) {
  return { meta: { err: null }, transaction: { signatures: [payment.signature], message: { accountKeys: [{ pubkey: signer.publicKey, signer: true }], instructions: [
    { programId: MEMO_PROGRAM, program: 'spl-memo', parsed: payment.memo },
    { programId: TOKEN_PROGRAM_ID, program: 'spl-token', parsed: { type: 'transferChecked', info: { mint: USDC_MINT.toBase58(), source: payment.sourceAta, destination: payment.destinationAta, authority: payment.sender, tokenAmount: { amount: '123456', decimals: 6 } } } },
  ] } } };
}
beforeEach(() => { vi.mocked(getMint).mockResolvedValue({ decimals: 6 } as Awaited<ReturnType<typeof getMint>>); vi.mocked(getAccount).mockResolvedValue({ amount: 1_000_000_000n } as Awaited<ReturnType<typeof getAccount>>); });

describe('devnet USDC transaction', () => {
  it.each(['0', '-1', '1e3', '0.0000001', 'NaN', '01', '', 0.1])('rejects unsafe or imprecise amount %s', value => { expect(() => amountUnits(value)).toThrow(); });
  it('uses exact six-decimal integer amounts and preserves memo bytes', async () => {
    expect(amountUnits('0.000001')).toBe(1n); expect(amountUnits('42.50')).toBe(42500000n);
    const { connection } = rpc(); const saved = await prepareUsdc(signer, request, connection);
    const tx = Transaction.from(Buffer.from(saved.transaction, 'base64'));
    expect(tx.verifySignatures()).toBe(true);
    expect(tx.instructions).toHaveLength(3);
    expect(tx.instructions[1].programId.equals(MEMO_PROGRAM)).toBe(true);
    expect(tx.instructions[1].data.equals(Buffer.from(request.memo, 'utf8'))).toBe(true);
    expect(tx.instructions[2].data[0]).toBe(12); // SPL TransferChecked discriminator.
    expect(tx.instructions[2].data.readBigUInt64LE(1)).toBe(123456n);
    expect(tx.instructions[2].data[9]).toBe(6);
    expect(tx.instructions[2].keys[1].pubkey.equals(USDC_MINT)).toBe(true);
  });
  it('rejects mainnet, invalid recipient, empty memo and oversized UTF-8 memo', () => {
    expect(() => validatePayment({ ...request, network: 'mainnet-beta' })).toThrow('solana-devnet');
    expect(() => validatePayment({ ...request, to: 'wrong' })).toThrow('address');
    expect(() => validatePayment({ ...request, memo: '' })).toThrow('memo');
    expect(() => validatePayment({ ...request, memo: 'µ'.repeat(257) })).toThrow('memo');
    expect(() => validatePayment({ ...request, memo: '\ud800' })).toThrow('memo');
  });
  it('refuses a mainnet RPC before constructing or sending a payment', async () => {
    const { fake, connection } = rpc(); fake.getGenesisHash.mockResolvedValue('mainnet-genesis');
    await expect(prepareUsdc(signer, request, connection)).rejects.toMatchObject({ code: 'WRONG_CLUSTER' });
    expect(fake.sendRawTransaction).not.toHaveBeenCalled();
  });
  it('checks token balance and SOL including destination account rent', async () => {
    const { fake, connection } = rpc(); vi.mocked(getAccount).mockResolvedValueOnce({ amount: 1n } as Awaited<ReturnType<typeof getAccount>>);
    await expect(prepareUsdc(signer, request, connection)).rejects.toMatchObject({ code: 'INSUFFICIENT_USDC' });
    fake.getBalance.mockResolvedValue(5000);
    await expect(prepareUsdc(signer, request, connection)).rejects.toMatchObject({ code: 'SOL_REQUIRED' });
    expect(fake.sendRawTransaction).not.toHaveBeenCalled();
  });
  it('does not broadcast unless persistence succeeds', async () => {
    const { fake, connection } = rpc();
    await expect(payUsdc(signer, request, { connection, persistSigned() { throw new Error('disk full'); } })).rejects.toThrow('disk full');
    expect(fake.sendRawTransaction).not.toHaveBeenCalled();
  });
  it('sends signed bytes once and returns a verified confirmed signature', async () => {
    const { fake, connection } = rpc(); const saved = await prepareUsdc(signer, request, connection);
    fake.getSignatureStatuses.mockResolvedValueOnce({ value: [null] }).mockResolvedValue({ value: [{ err: null, confirmationStatus: 'confirmed' }] });
    fake.sendRawTransaction.mockResolvedValue(saved.signature); fake.getParsedTransaction.mockResolvedValue(chainRecord(saved));
    await expect(settleUsdc(connection, saved, { pollMs: 0, timeoutMs: 1000 })).resolves.toBe(saved.signature);
    expect(fake.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(fake.sendRawTransaction.mock.calls[0][0]).toEqual(Buffer.from(saved.transaction, 'base64'));
  });
  it('reconciles an ambiguous send without signing a replacement', async () => {
    const { fake, connection } = rpc(); const saved = await prepareUsdc(signer, request, connection);
    fake.getSignatureStatuses.mockResolvedValueOnce({ value: [null] }).mockResolvedValue({ value: [{ err: null, confirmationStatus: 'finalized' }] });
    fake.sendRawTransaction.mockRejectedValue(new Error('RPC timeout after accepting bytes')); fake.getParsedTransaction.mockResolvedValue(chainRecord(saved));
    await expect(settleUsdc(connection, saved, { pollMs: 0, timeoutMs: 1000 })).resolves.toBe(saved.signature);
    expect(fake.sendRawTransaction).toHaveBeenCalledTimes(1);
  });
  it('waits for an already processed transaction even after its blockhash expiry', async () => {
    const { fake, connection } = rpc(); const saved = await prepareUsdc(signer, request, connection);
    fake.getSignatureStatuses.mockResolvedValueOnce({ value: [{ err: null, confirmationStatus: 'processed' }] }).mockResolvedValue({ value: [{ err: null, confirmationStatus: 'confirmed' }] });
    fake.getBlockHeight.mockResolvedValue(2000); fake.getParsedTransaction.mockResolvedValue(chainRecord(saved));
    await expect(settleUsdc(connection, saved, { pollMs: 0, timeoutMs: 1000 })).resolves.toBe(saved.signature);
    expect(fake.sendRawTransaction).not.toHaveBeenCalled();
  });
  it('rejects failed, expired, pending and mismatched transactions', async () => {
    const { fake, connection } = rpc(); const saved = await prepareUsdc(signer, request, connection);
    fake.getSignatureStatuses.mockResolvedValue({ value: [{ err: { InstructionError: [1, 'failure'] } }] });
    await expect(settleUsdc(connection, saved)).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' });
    fake.getSignatureStatuses.mockResolvedValue({ value: [null] }); fake.getBlockHeight.mockResolvedValue(1001);
    await expect(settleUsdc(connection, saved)).rejects.toMatchObject({ code: 'PAYMENT_EXPIRED' });
    expect(fake.sendRawTransaction).not.toHaveBeenCalled();
    fake.getBlockHeight.mockResolvedValue(500); fake.sendRawTransaction.mockResolvedValue(saved.signature);
    await expect(settleUsdc(connection, saved, { timeoutMs: 0, pollMs: 0 })).rejects.toMatchObject({ code: 'PAYMENT_PENDING' });
    const record = chainRecord(saved); record.transaction.message.instructions[0].parsed = 'different memo';
    fake.getParsedTransaction.mockResolvedValue(record);
    await expect(verifyPayment(connection, saved)).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' });
    const otherAmount = chainRecord(saved); const transfer = otherAmount.transaction.message.instructions[1].parsed;
    if (typeof transfer !== 'string') transfer.info.tokenAmount.amount = '123457';
    fake.getParsedTransaction.mockResolvedValue(otherAmount);
    await expect(verifyPayment(connection, saved)).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' });
  });
});
