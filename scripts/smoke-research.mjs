/** Production HTTP research-loop checks. Only a disposable synthetic database is changed. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
const root=resolve(import.meta.dirname,'..'), web=join(root,'OpenFoundry/apps/web');
const temp=await mkdtemp(join(tmpdir(),'labrelax-research-smoke-'));
const port=await new Promise(resolvePort=>{const probe=createServer();probe.listen(0,'127.0.0.1',()=>{const port=probe.address().port;probe.close(()=>resolvePort(port));});});
const origin=`http://127.0.0.1:${port}`;
let child,cookie='',csrf='',checks=0;
async function start(){
  let output='';
  child=spawn(process.execPath,['build/index.js'],{cwd:web,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),ORIGIN:origin,BODY_SIZE_LIMIT:'3M',LABRELAX_DEMO_MODE:'true',LABRELAX_SEED_DEMO:'true',LABRELAX_DB_PATH:join(temp,'research.sqlite'),OPENAI_API_KEY:''},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',value=>output+=value);child.stderr.on('data',value=>output+=value);
  for(let tries=0;tries<150;tries++){try{if((await fetch(`${origin}/lab`)).ok)return;}catch{} if(child.exitCode!==null)throw Error(output);await new Promise(r=>setTimeout(r,100));}
  throw Error(`Server did not start: ${output}`);
}
async function stop(){if(!child||child.exitCode!==null)return;child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}
async function request(path,{method='GET',body,expected=200,auth=true,token=csrf}={}){
  const response=await fetch(`${origin}/api/lab${path}`,{method,headers:{...(auth&&cookie?{Cookie:cookie}:{}),...(method!=='GET'?{Origin:origin,'X-CSRF-Token':token}:{}),...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
  assert.equal(response.status,expected,`${method} ${path}: ${await response.clone().text()}`);checks++;return response;
}
const json=async(...args)=>(await request(...args)).json();
async function session(){const response=await request('/session');cookie=response.headers.get('set-cookie')?.split(';')[0]||cookie;csrf=(await response.json()).csrf_token;}
async function run(id,key){const job=await json(`/investigations/${id}/runs`,{method:'POST',body:{idempotency_key:key},expected:202});for(let i=0;i<100;i++){const saved=await json(`/investigations/${id}/runs/${job.id}`);if(saved.status==='failed')throw Error(saved.error);if(saved.status==='completed')return saved;await new Promise(r=>setTimeout(r,50));}throw Error('Research run did not complete');}
const source=async(name)=>readFile(join(web,'static/research-companion',name),'utf8');
try{
  await start();
  await request('/investigations?project_id=demo-lab',{expected:401,auth:false});await session();
  await request('/investigations?project_id=restricted-project',{expected:404});
  await request('/investigations',{method:'POST',body:{project_id:'demo-lab',title:'x',goal:'x'},token:'wrong',expected:403});
  const original=(await json('/inventory?project_id=demo-lab')).resources;
  // An explicitly reviewed engineering-only baseline, isolated from the team's workspace.
  const stock=original.map(row=>({...row,balance:row.id==='indicator-b'?'300':row.balance,lots:row.id==='indicator-b'?[{id:'IND-QA',balance:'300',expires:null}]:row.lots}));
  await json('/inventory/import',{method:'POST',body:{project_id:'demo-lab',confirmed:true,source_name:'Isolated research acceptance baseline',resources:stock}});
  const before=await json('/inventory?project_id=demo-lab');
  const file=new FormData();file.set('project_id','demo-lab');file.set('file',new Blob([await readFile(join(web,'static/fixtures/synthetic_microplate_sop.pdf'))],{type:'application/pdf'}),'engineering-test-sop.pdf');
  const protocol=await json('/protocols/parse',{method:'POST',body:file,expected:201});
  await json(`/protocols/${protocol.id}/approve`,{method:'POST',body:{rows:protocol.rows,fixed_controls:2,replicates_per_specimen:1,overage_percent:'10',acknowledged:true}});
  const approved=(await json('/protocols?project_id=demo-lab')).protocols;assert.equal(approved[0].status,'approved');checks++;
  const investigation=await json('/investigations',{method:'POST',body:{project_id:'demo-lab',title:'Synthetic measurement-order investigation',goal:'Is the apparent sample effect real or associated with measurement order?',protocol_id:protocol.id},expected:201});
  const other=await json('/investigations',{method:'POST',body:{project_id:'demo-lab',title:'Other investigation',goal:'Keep evidence scoped.'},expected:201});
  const csv=await source('synthetic-initial.csv');
  await request(`/investigations/${investigation.id}/evidence`,{method:'POST',body:{phase:'initial',kind:'synthetic_observation',filename:'bad.csv',csv:'run_id,bad\nx,y',protocol_version:'1.0'},expected:400});
  const evidence=await json(`/investigations/${investigation.id}/evidence`,{method:'POST',body:{phase:'initial',kind:'synthetic_observation',filename:'synthetic-initial.csv',csv,protocol_version:'1.0',note:'Synthetic engineering observation; no physical run performed.'},expected:201});
  assert.equal(evidence.content_hash,createHash('sha256').update(csv).digest('hex'));assert.equal(evidence.rows.length,10);checks++;
  await request(`/investigations/${other.id}/evidence/${evidence.id}/source`,{expected:404});
  assert.equal(await(await request(`/investigations/${investigation.id}/evidence/${evidence.id}/source`)).text(),csv);checks++;
  const initial=await run(investigation.id,'initial-before-design');assert.equal(initial.mode,'scripted_walkthrough');assert.equal(initial.steps.length,5);checks++;
  let detail=await json(`/investigations/${investigation.id}`);assert.equal(detail.analyses[0].output.classification,'confounded');assert.equal(detail.proposals[0].status,'needs_design');checks++;
  const manifest=await json(`/investigations/${investigation.id}/design/review`,{method:'POST',body:{protocol_id:protocol.id,acknowledged:true,rationale:'Human-reviewed synthetic counterbalanced design.'}});assert.equal(manifest.specimen_count,8);assert.equal(manifest.assignments.length,10);checks++;
  const prepared=await run(investigation.id,'prepare-full-design');
  detail=await json(`/investigations/${investigation.id}`);const proposal=detail.proposals.at(-1);
  assert.deepEqual(prepared.steps.map(step=>step.tool),['read_evidence','analyse_results','inspect_design','check_materials','save_recommendation']);assert.equal(proposal.material_plan.status,'RESOURCE-SUFFICIENT');assert.deepEqual(proposal.material_plan.lines.map(row=>row.required),['660','165','1100']);checks++;
  const replay=await json(`/investigations/${investigation.id}/runs`,{method:'POST',body:{idempotency_key:'prepare-full-design'},expected:202});assert.equal(replay.id,prepared.id);checks++;
  const reviewed=await json(`/investigations/${investigation.id}/proposals/${proposal.id}/review`,{method:'POST',body:{acknowledged:true}});assert.equal(reviewed.status,'awaiting_results');checks++;
  const continuity=await json(`/experiments/${proposal.experiment_id}/continuity`);assert.equal(continuity.events.length,0);assert.equal(continuity.experiment.status,'planned');checks++;
  await json(`/investigations/${investigation.id}/evidence`,{method:'POST',body:{phase:'followup',kind:'synthetic_observation',filename:'synthetic-followup.csv',csv:await source('synthetic-followup.csv'),protocol_version:'1.0',experiment_id:proposal.experiment_id},expected:201});
  await request(`/investigations/${investigation.id}/proposals/${proposal.id}/review`,{method:'POST',body:{acknowledged:true},expected:409});
  await run(investigation.id,'analyse-counterbalanced-result');
  detail=await json(`/investigations/${investigation.id}`);assert.equal(detail.analyses.at(-1).output.classification,'order_trend');assert.equal(detail.revisions.at(-1).hypotheses[0].support,'weakened');assert.equal(detail.revisions.at(-1).hypotheses[1].support,'provisionally_supported');assert.equal(detail.proposals.at(-1).status,'direction_only');assert.equal(detail.proposals.at(-1).material_plan,null);checks++;
  await request(`/investigations/${investigation.id}/proposals/${detail.proposals.at(-1).id}/review`,{method:'POST',body:{acknowledged:true},expected:409});
  await json(`/investigations/${investigation.id}/evidence`,{method:'POST',body:{phase:'followup',kind:'synthetic_observation',filename:'synthetic-no-signal.csv',csv:await source('synthetic-no-signal.csv'),protocol_version:'1.0'},expected:201});await run(investigation.id,'counterexample-no-signal');
  detail=await json(`/investigations/${investigation.id}`);assert.equal(detail.analyses.at(-1).output.classification,'no_clear_signal');assert.equal(detail.revisions.at(-1).hypotheses[0].support,'unresolved');checks++;
  assert.deepEqual(await json('/inventory?project_id=demo-lab'),before);assert.equal((await json(`/experiments/${proposal.experiment_id}/continuity`)).events.length,0);checks++;
  const ids={evidence:evidence.id,run:prepared.id,revision:detail.revisions.at(-1).id};
  await stop();cookie='';await start();await session();
  const persisted=await json(`/investigations/${investigation.id}`);assert.equal(persisted.evidence[0].id,ids.evidence);assert.equal(persisted.runs[1].id,ids.run);assert.equal(persisted.revisions.at(-1).id,ids.revision);assert.deepEqual(await json('/inventory?project_id=demo-lab'),before);checks++;
  console.log(`PASS: ${checks} production research HTTP/contract checks, including restart persistence, changed conclusions and zero stock consumption.`);
}finally{await stop();await rm(temp,{recursive:true,force:true});}
