/** Runs against an isolated built Node server and temporary synthetic-only SQLite file. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
const root = resolve(import.meta.dirname, '..');
const web = join(root, 'OpenFoundry/apps/web');
const temp = await mkdtemp(join(tmpdir(), 'labrelax-smoke-'));
const port = await new Promise(resolvePort => { const probe = createServer(); probe.listen(0, '127.0.0.1', () => { const value = probe.address().port; probe.close(() => resolvePort(value)); }); });
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['build/index.js'], { cwd: web, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ORIGIN: origin, BODY_SIZE_LIMIT: '3M', LABRELAX_DEMO_MODE: 'true', LABRELAX_SEED_DEMO: 'true', LABRELAX_DB_PATH: join(temp, 'test.sqlite'), OPENAI_API_KEY: '' }, stdio: ['ignore','pipe','pipe'] });
let output = ''; child.stdout.on('data', value => output += value); child.stderr.on('data', value => output += value);
let cookie = '', csrf = '', checks = 0;
async function call(path, { method = 'GET', body, expected = 200, authenticated = true, csrfValue = csrf, headers = {} } = {}) {
  const response = await fetch(`${origin}/api/lab${path}`, { method, headers: { ...(authenticated && cookie ? { Cookie: cookie } : {}), ...(method !== 'GET' ? { Origin: origin, 'X-CSRF-Token': csrfValue } : {}), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  assert.equal(response.status, expected, `${method} ${path}: ${response.status} != ${expected}; ${await response.clone().text()}`); checks++;
  return response;
}
const json = async (...args) => (await call(...args)).json();
try {
  for (let tries = 0; tries < 150; tries++) { try { if ((await fetch(`${origin}/lab`)).ok) break; } catch {} if (child.exitCode !== null) throw new Error(output); await new Promise(r => setTimeout(r, 100)); }
  await call('/inventory?project_id=demo-lab', { expected: 401, authenticated: false });
  const session = await call('/session'); cookie = session.headers.get('set-cookie').split(';')[0]; csrf = (await session.json()).csrf_token;
  const stockBefore = await json('/inventory?project_id=demo-lab');
  assert.deepEqual(stockBefore.resources.map(row => row.balance), ['700','150','2000']); checks++;
  await call('/inventory?project_id=restricted-project', { expected: 404 });
  await call('/protocols/not-permitted/source', { expected: 404 });
  await call('/run-plans/preview', { method: 'POST', body: {}, csrfValue: 'wrong', expected: 403 });
  const upload = new FormData(); upload.set('project_id','demo-lab'); upload.set('file', new Blob([await readFile(join(web,'static/fixtures/synthetic_microplate_sop.pdf'))],{type:'application/pdf'}),'engineering-test.pdf');
  const draft = await json('/protocols/parse', { method:'POST',body:upload,expected:201 });
  assert.equal(draft.status, 'draft'); assert.equal(draft.extraction_method,'supported-template'); checks++;
  const source = await call(`/protocols/${draft.id}/source`); assert.equal(source.headers.get('content-type'),'application/pdf'); assert.ok((await source.arrayBuffer()).byteLength > 100); checks++;
  await call('/run-plans/preview',{method:'POST',body:{project_id:'demo-lab',protocol_id:draft.id,specimen_count:8},expected:409});
  const reviewed = await json(`/protocols/${draft.id}/approve`,{method:'POST',body:{rows:draft.rows,fixed_controls:draft.fixed_controls,replicates_per_specimen:draft.replicates_per_specimen,overage_percent:draft.overage_percent,acknowledged:true}});
  assert.equal(reviewed.reviewed_by,'demo-researcher'); checks++;
  for (const specimen_count of [-1,1.5,'8']) await call('/run-plans/preview',{method:'POST',body:{project_id:'demo-lab',protocol_id:draft.id,specimen_count},expected:400});
  const plan8 = await json('/run-plans/preview',{method:'POST',body:{project_id:'demo-lab',protocol_id:draft.id,specimen_count:8},expected:201});
  assert.equal(plan8.status,'SHORTAGE'); assert.deepEqual(plan8.lines.map(row=>row.required),['660','165','1100']); assert.equal(plan8.lines[1].shortage,'15'); checks++;
  const plan6 = await json('/run-plans/preview',{method:'POST',body:{project_id:'demo-lab',protocol_id:draft.id,specimen_count:6,experiment_id:plan8.experiment_id},expected:201});
  assert.equal(plan6.status,'RESOURCE-SUFFICIENT'); assert.deepEqual(plan6.lines.map(row=>row.required),['528','132','880']); checks++;
  assert.deepEqual(await json('/inventory?project_id=demo-lab'),stockBefore); checks++;
  assert.equal((await json(`/experiments/${plan6.experiment_id}/continuity`)).events.length,0); checks++;
  const competing = await json('/run-plans/preview',{method:'POST',body:{project_id:'demo-lab',protocol_id:draft.id,specimen_count:1},expected:201});
  const confirmationBody = {plan_id:plan6.id,idempotency_key:'isolated-smoke-confirm',confirmed:true,actuals:plan6.lines.map(row=>({resource_id:row.resource_id,amount:row.resource_id==='indicator-b'?'130':row.required,unit:'uL',lot_id:null})),justification:'Synthetic test: actual preparation consumption differs from plan.'};
  const confirmation = await json(`/experiments/${plan6.experiment_id}/consumption/confirm`,{method:'POST',body:confirmationBody});
  assert.equal(confirmation.events.length,3); checks++;
  const replay = await json(`/experiments/${plan6.experiment_id}/consumption/confirm`,{method:'POST',body:confirmationBody}); assert.equal(replay.replayed,true); assert.equal(replay.id,confirmation.id); checks++;
  const after = await json('/inventory?project_id=demo-lab'); assert.deepEqual(after.resources.map(row=>row.balance),['172','20','1120']); checks++;
  await call(`/experiments/${competing.experiment_id}/consumption/confirm`,{method:'POST',body:{plan_id:competing.id,idempotency_key:'competing',confirmed:true,actuals:competing.lines.map(row=>({resource_id:row.resource_id,amount:row.required,unit:'uL',lot_id:null})),justification:''},expected:409});
  const history = await json(`/experiments/${plan6.experiment_id}/continuity`); assert.equal(history.events.length,3); assert.equal(history.plans.length,2); assert.equal(history.experiment.status,'completed'); assert.ok(history.issues.includes('Actual-use lot is unverified.')); checks++;
  console.log(`PASS: ${checks} HTTP/contract checks against an isolated production Node server. No team data was modified.`);
} finally {
  child.kill('SIGTERM');
  await new Promise(resolveExit => { if(child.exitCode!==null) resolveExit(); else child.once('exit',resolveExit); });
  await rm(temp,{recursive:true,force:true});
}
