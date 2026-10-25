/** Exercise the presentation loop against a production server and disposable database. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const web = join(root, 'OpenFoundry/apps/web');
const temp = await mkdtemp(join(tmpdir(), 'labrelax-pcr-smoke-'));
const port = await new Promise(resolvePort => {
  const probe = createServer();
  probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolvePort(port)); });
});
const origin = `http://127.0.0.1:${port}`;
let child, cookie = '', csrf = '', checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const source = name => readFile(join(web, 'static/pcr-demo', name), 'utf8');
async function start() {
  let output = '';
  child = spawn(process.execPath, ['build/index.js'], {
    cwd: web,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ORIGIN: origin, LABRELAX_DEMO_MODE: 'true', LABRELAX_DB_PATH: join(temp, 'demo.sqlite'), OPENAI_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', value => output += value); child.stderr.on('data', value => output += value);
  for (let attempt = 0; attempt < 150; attempt++) {
    try { if ((await fetch(`${origin}/lab`)).ok) return; } catch { /* wait for startup */ }
    if (child.exitCode !== null) throw Error(output);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error(`Production server did not start: ${output}`);
}
async function stop() { if (child && child.exitCode === null) { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)); } }
async function request(path, { body, expected = 200, auth = true, token = csrf } = {}) {
  const response = await fetch(`${origin}/api/lab${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(auth && cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { Origin: origin, 'X-CSRF-Token': token, 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  assert.equal(response.status, expected, `${path}: ${await response.clone().text()}`); checks++;
  return response;
}
const json = async (...args) => (await request(...args)).json();
async function session() { const response = await request('/session'); cookie = response.headers.get('set-cookie')?.split(';')[0] || cookie; csrf = (await response.json()).csrf_token; }
const base = '/pcr-demo/investigations';
async function select(detail, option, key) {
  const round = detail.current_round;
  return json(`${base}/${detail.investigation.id}/select`, { body: { option_id: option, round_id: round.id, analysis_id: round.analysis.id, acknowledged: true, idempotency_key: key }, expected: 201 });
}
async function results(detail, fixture, key, csvOverride) {
  return json(`${base}/${detail.investigation.id}/results`, { body: { csv: csvOverride ?? await source(fixture), filename: fixture, fictional: true, selection_id: detail.current_round.selection.id, idempotency_key: key }, expected: 201 });
}
try {
  await start();
  await request('/pcr-demo/scenario', { auth: false, expected: 401 });
  await session();
  const scenario = await json('/pcr-demo/scenario');
  check(scenario.mode === 'fictional_scenario', 'The demo must identify its fictional mode.');
  const pdf = new Uint8Array(await (await fetch(`${origin}${scenario.source_url}`)).arrayBuffer());
  check(createHash('sha256').update(pdf).digest('hex') === scenario.source_sha256, 'The original source must match its saved fingerprint.');
  const baseline = await json('/inventory?project_id=demo-lab');
  await request(`${base}?project_id=another-lab`, { expected: 404 });
  await request(base, { body: {}, token: 'wrong', expected: 403 });
  const input = { project_id: 'demo-lab', title: 'PCR HTTP presentation', question: scenario.question, csv: await source('initial.csv'), filename: 'initial.csv', fictional: true, source_sha256: scenario.source_sha256, source_filename: scenario.source_filename, idempotency_key: 'create-1' };
  await request(base, { body: { ...input, source_sha256: 'wrong' }, expected: 400 });
  await request(base, { body: { ...input, fictional: false }, expected: 400 });
  let detail = await json(base, { body: input, expected: 201 });
  const id = detail.investigation.id;
  const replay = await json(base, { body: input, expected: 201 });
  check(replay.investigation.id === id, 'Create retries must not create another presentation.');
  check(detail.current_round.analysis === null, 'Evidence import must stay separate from analysis.');
  detail = await json(`${base}/${id}/analyse`, { body: {} });
  check(Math.abs(detail.current_round.analysis.metrics.target_mean - 72.8333333333) < 1e-6, 'Target mean must use the actual six specimen rows.');
  check(detail.current_round.analysis.metrics.target_cv_percent > 20, 'Baseline variability should remain visible.');
  check(detail.current_round.analysis.options.length === 3, 'The presenter needs three supported choices.');
  const analysisId = detail.current_round.analysis.id;
  const analysedAgain = await json(`${base}/${id}/analyse`, { body: {} });
  check(analysedAgain.current_round.analysis.id === analysisId, 'Repeated analysis should reuse the same evidence calculation.');
  await request(`${base}/${id}/select`, { body: { option_id: 'specificity', round_id: detail.current_round.id, analysis_id: 'stale', acknowledged: true }, expected: 409 });
  detail = await select(detail, 'specificity', 'select-1');
  const selectedId = detail.current_round.selection.id;
  check(detail.current_round.selection.evidence_hash === detail.current_round.content_hash, 'Choice must retain its source snapshot.');
  const selectedAgain = await select(detail, 'specificity', 'select-1');
  check(selectedAgain.current_round.selection.id === selectedId, 'Selection retries must not create another choice.');
  const next = await results(detail, 'specificity.csv', 'result-1');
  check(next.rounds.length === 2 && next.current_round.parent_selection_id === selectedId, 'New evidence must belong to the chosen experiment.');
  const replayedResult = await results(detail, 'specificity.csv', 'result-1');
  check(replayedResult.current_round.id === next.current_round.id, 'Result retries must not create another round.');
  detail = await json(`${base}/${id}/analyse`, { body: {} });
  check(detail.current_round.analysis.metrics.background_ratio_percent < 11, 'Cleaner result should reduce calculated background.');
  check(detail.current_round.analysis.headline !== detail.rounds[0].analysis.headline, 'Different evidence should change the interpretation.');
  check(!!detail.current_round.analysis.why_changed, 'The change in interpretation must be explained.');
  check(detail.current_round.analysis.options.find(option => option.recommended)?.id === 'independent-repeat', 'Cleaner observations should make confirmation the next priority.');
  await request(`${base}/${id}/results`, { body: { csv: await source('initial.csv'), filename: 'stale.csv', fictional: true, selection_id: selectedId, idempotency_key: 'stale-result' }, expected: 409 });
  detail = await select(detail, 'consistency', 'select-2');
  detail = await results(detail, 'consistency.csv', 'result-2');
  detail = await json(`${base}/${id}/analyse`, { body: {} });
  check(detail.rounds.length === 3, 'The workflow must support more than one follow-up.');
  check(detail.current_round.analysis.metrics.target_cv_percent < 2 && detail.current_round.analysis.metrics.background_ratio_percent > 30, 'Consistency outcome must preserve its unresolved background.');
  check(detail.current_round.analysis.options.find(option => option.recommended)?.id === 'specificity', 'Remaining background must change the next recommendation.');
  const stockAfter = await json('/inventory?project_id=demo-lab');
  check(JSON.stringify(stockAfter) === JSON.stringify(baseline), 'No fictional analysis or selection may consume or replace stock.');
  await stop(); await start(); await session();
  const restored = await json(`${base}/${id}`);
  check(restored.rounds.length === 3 && restored.rounds[0].selection.id === selectedId, 'Evidence and decision history must survive a server restart.');
  console.log(`PASS: ${checks} production PCR demo checks, including real calculations, experiment choices, repeated learning, persistence and unchanged inventory.`);
} finally { await stop(); await rm(temp, { recursive: true, force: true }); }
