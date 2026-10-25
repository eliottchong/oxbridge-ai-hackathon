import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const [command, file] = process.argv.slice(2);
try {
  if (command === 'wallet') {
    const require = createRequire(new URL('../OpenFoundry/apps/web/package.json', import.meta.url));
    const { Keypair } = require('@solana/web3.js');
    const signer = Keypair.generate();
    const path = resolve(file || '.wallets/devnet-agent.json');
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify(Array.from(signer.secretKey)), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ network: 'solana-devnet', address: signer.publicKey.toBase58(), keypairPath: path, apiToken: randomBytes(32).toString('hex') }, null, 2));
  } else if (command === 'run' && file) {
    const task = JSON.parse(readFileSync(resolve(file), 'utf8'));
    const token = process.env.LABRELAX_PAYMENTS_API_TOKEN;
    if (!token) throw new Error('Set LABRELAX_PAYMENTS_API_TOKEN for the payment API.');
    const base = process.env.LABRELAX_PAYMENTS_BASE_URL || 'http://127.0.0.1:5173';
    const url = new URL('/api/agent/run_workflow', base);
    if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Use HTTPS except on loopback.');
    const response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120_000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(task) });
    const result = await response.json();
    if (!response.ok) { console.error(JSON.stringify(result)); process.exitCode = 1; }
    else console.log(JSON.stringify(result));
  } else throw new Error('Usage: node scripts/payments.mjs wallet [new-keypair-path] | run <task.json>');
} catch (error) { console.error(error.code === 'EEXIST' ? 'Wallet file already exists; it was not overwritten.' : error.message); process.exitCode = 1; }
