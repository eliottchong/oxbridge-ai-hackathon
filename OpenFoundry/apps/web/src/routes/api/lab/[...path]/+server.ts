import { json, type RequestEvent, type RequestHandler } from '@sveltejs/kit';
import { ApiError, invalid, notFound } from '$lib/server/preflight/errors';
import { authenticate, issueSession, demoEnabled, accessTokenValid, csrfToken, requireMutation, requireProject } from '$lib/server/preflight/auth';
import { getStore } from '$lib/server/preflight/store';
import { LabService } from '$lib/server/preflight/service';
import { parseProtocolFile, ProtocolParseError, MAX_PROTOCOL_BYTES } from '$lib/server/preflight/parser';
import { transcribeWithAI, AITranscriptionError } from '$lib/server/preflight/ai-transcription';
import { ResearchService } from '$lib/server/research/service';
import { startResearchRun } from '$lib/server/research/agent';
import type { ProtocolDraft } from '$lib/preflight/types';

async function readBounded(request: Request, maximum: number): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) { await reader.cancel(); throw new ApiError(413, 'REQUEST_TOO_LARGE', 'The upload exceeds the supported size limit.'); }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}
async function bodyJson(event: RequestEvent): Promise<Record<string, unknown>> {
  if (!event.request.headers.get('content-type')?.startsWith('application/json')) throw invalid('Send a JSON request.');
  const raw = new TextDecoder().decode(await readBounded(event.request, 64 * 1024));
  try { const value = JSON.parse(raw); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); return value; }
  catch { throw invalid('Send a valid JSON object.'); }
}
async function handle(event: RequestEvent): Promise<Response> {
  try {
    const path = event.params.path || '';
    const method = event.request.method;
    if (path === 'session' && method === 'POST') {
      if (event.request.headers.get('origin') !== event.url.origin) throw new ApiError(403, 'ORIGIN_REJECTED', 'Use the same lab application origin.');
      const body = await bodyJson(event);
      if (!accessTokenValid(body.access_token)) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid workspace access token.');
      const actor = issueSession(event, false);
      return json({ user: { id: actor.id, name: actor.name, role: actor.role }, csrf_token: csrfToken(actor), projects: [{ id: 'demo-lab', name: 'Synthetic preflight workspace', can_write: true }], demo_mode: false });
    }
    if (path === 'session' && method === 'GET') {
      let actor;
      try { actor = authenticate(event); }
      catch (error) { if (!demoEnabled()) throw error; actor = issueSession(event, true); }
      return json({ user: { id: actor.id, name: actor.name, role: actor.role }, csrf_token: csrfToken(actor), projects: [{ id: 'demo-lab', name: 'Synthetic preflight workspace', can_write: true }], demo_mode: actor.demo });
    }
    const actor = authenticate(event);
    if (method !== 'GET') requireMutation(event, actor);
    const service = new LabService(getStore());
    if (path === 'protocols' && method === 'GET') {
      const project = event.url.searchParams.get('project_id');
      requireProject(actor, project);
      return json({ protocols: service.store.list<ProtocolDraft>('protocols', project) });
    }
    if (path === 'investigations' || path.startsWith('investigations/')) {
      const research = new ResearchService(service.store);
      if (path === 'investigations' && method === 'GET') return json({ investigations: research.list(actor, event.url.searchParams.get('project_id')) });
      if (path === 'investigations' && method === 'POST') return json(research.create(actor, await bodyJson(event)), { status: 201 });
      const investigation = /^investigations\/([^/]+)$/.exec(path);
      if (investigation && method === 'GET') return json(research.detail(actor, investigation[1]));
      const evidence = /^investigations\/([^/]+)\/evidence$/.exec(path);
      if (evidence && method === 'POST') return json(research.importEvidence(actor, evidence[1], await bodyJson(event)), { status: 201 });
      const evidenceSource = /^investigations\/([^/]+)\/evidence\/([^/]+)\/source$/.exec(path);
      if (evidenceSource && method === 'GET') {
        const [record] = research.readEvidence(actor, evidenceSource[1], [evidenceSource[2]]);
        return new Response(record.original_content, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="investigation-evidence.csv"', 'X-Content-Type-Options': 'nosniff' } });
      }
      const design = /^investigations\/([^/]+)\/design\/review$/.exec(path);
      if (design && method === 'POST') return json(research.reviewDesign(actor, design[1], await bodyJson(event)));
      const runs = /^investigations\/([^/]+)\/runs$/.exec(path);
      if (runs && method === 'POST') return json(startResearchRun(research, actor, runs[1], (await bodyJson(event)).idempotency_key), { status: 202 });
      const run = /^investigations\/([^/]+)\/runs\/([^/]+)$/.exec(path);
      if (run && method === 'GET') return json(research.getRun(actor, run[1], run[2]));
      const review = /^investigations\/([^/]+)\/proposals\/([^/]+)\/review$/.exec(path);
      if (review && method === 'POST') return json(research.reviewProposal(actor, review[1], review[2], await bodyJson(event)));
    }
    if (path === 'inventory' && method === 'GET') return json({ resources: service.inventory(actor, event.url.searchParams.get('project_id')) });
    if (path === 'inventory/import' && method === 'POST') return json(service.importInventory(actor, await bodyJson(event)));
    if (path === 'experiments' && method === 'GET') return json({ experiments: service.experiments(actor, event.url.searchParams.get('project_id')) });
    if (path === 'protocols/parse' && method === 'POST') {
      const length = Number(event.request.headers.get('content-length'));
      if (length > MAX_PROTOCOL_BYTES + 16384) throw new ApiError(413, 'UPLOAD_TOO_LARGE', 'Upload a PDF of at most 2 MB.');
      if (!event.request.headers.get('content-type')?.startsWith('multipart/form-data')) throw invalid('Upload the PDF using multipart form data.');
      const uploadBytes = await readBounded(event.request, MAX_PROTOCOL_BYTES + 16384);
      const form = await new Response(Uint8Array.from(uploadBytes).buffer, { headers: { 'Content-Type': event.request.headers.get('content-type')! } }).formData();
      const project = form.get('project_id');
      requireProject(actor, project, true);
      const file = form.get('file');
      if (!(file instanceof File)) throw invalid('A protocol PDF file is required.');
      if (file.type && file.type !== 'application/pdf') throw invalid('Only PDF uploads are supported.');
      if (file.size > MAX_PROTOCOL_BYTES) throw new ApiError(413, 'UPLOAD_TOO_LARGE', 'Upload a PDF of at most 2 MB.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsed = await transcribeWithAI(await parseProtocolFile(bytes, file.name));
      return json(service.saveDraft(actor, project, { ...parsed, filename: file.name.slice(0, 200) }, bytes), { status: 201 });
    }
    const approval = /^protocols\/([^/]+)\/approve$/.exec(path);
    if (approval && method === 'POST') return json(service.approve(actor, approval[1], await bodyJson(event)));
    const source = /^protocols\/([^/]+)\/source$/.exec(path);
    if (source && method === 'GET') {
      service.protocol(actor, source[1]);
      const row = service.store.db.prepare('SELECT source FROM protocols WHERE id=?').get(source[1]) as { source: Uint8Array };
      return new Response(new Uint8Array(row.source), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="protocol.pdf"', 'Content-Security-Policy': "sandbox; default-src 'none'", 'X-Content-Type-Options': 'nosniff' } });
    }
    if (path === 'run-plans/preview' && method === 'POST') return json(service.preview(actor, await bodyJson(event)), { status: 201 });
    const confirm = /^experiments\/([^/]+)\/consumption\/confirm$/.exec(path);
    if (confirm && method === 'POST') return json(service.confirm(actor, confirm[1], await bodyJson(event)));
    const continuity = /^experiments\/([^/]+)\/continuity$/.exec(path);
    if (continuity && method === 'GET') return json(service.continuity(actor, continuity[1]));
    throw notFound();
  } catch (error) {
    if (error instanceof AITranscriptionError) return json({ error: { code: error.code, message: error.message } }, { status: 502 });
    if (error instanceof ProtocolParseError) return json({ error: { code: error.code, message: error.message } }, { status: error.code === 'UPLOAD_TOO_LARGE' ? 413 : 400 });
    if (error instanceof ApiError) return json({ error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } }, { status: error.status });
    console.error('LabRelax request failed:', error instanceof Error ? error.message : 'Unknown error');
    return json({ error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed. No partial stock changes were committed.' } }, { status: 500 });
  }
}
const respond: RequestHandler = async (event) => {
  const response = await handle(event);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
};
export const GET = respond;
export const POST = respond;
