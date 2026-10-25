import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { addExperiment, seed } from '$lib/lab/model';
import type { RequestHandler } from './$types';

// ponytail: local demo endpoint, no account system. Add authenticated quotas before hosting.
export const POST: RequestHandler = async ({ request }) => {
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'Same-origin requests only.' }, { status: 403 });
  if (!env.OPENAI_API_KEY) return json({ error: 'AI is not configured. Use the experiment form, or set OPENAI_API_KEY on the local server.' }, { status: 503 });
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 5000) throw new Error();
    body = JSON.parse(raw);
    if (typeof body.request !== 'string' || !body.request.trim() || body.request.length > 2000) throw new Error();
  } catch { return json({ error: 'Enter a request between 1 and 2,000 characters.' }, { status: 400 }); }
  const lab = seed();
  const start = performance.now();
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: env.OPENAI_MODEL || 'gpt-4o-mini', store: false, max_output_tokens: 1500,
        instructions: `Extract a lab experiment draft from the request. Demo date: ${lab.today}. Extract only explicitly supplied resource quantities, never infer a scientific protocol or required dosage. Unknown details go in notes. Never approve or pay. Allowed catalog: ${JSON.stringify(lab.supplies.map(({ id, name, unit }) => ({ id, name, unit })))}`,
        input: body.request,
        text: { format: { type: 'json_schema', name: 'experiment_draft', strict: true, schema: { type: 'object', additionalProperties: false,
          properties: { name: { type: 'string' }, date: { type: 'string' }, notes: { type: 'string' }, needs: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { supply: { type: 'string', enum: lab.supplies.map(s => s.id) }, quantity: { type: 'integer' } }, required: ['supply', 'quantity'] } } }, required: ['name', 'date', 'notes', 'needs'] } } },
      }),
    });
    if (!response.ok) return json({ error: `AI provider unavailable (${response.status}). Use the form; no changes were made.` }, { status: 502 });
    const result = await response.json();
    if (result.status !== 'completed') throw new Error('incomplete');
    const output = result.output?.flatMap((item: { content?: { type: string; text?: string }[] }) => item.content ?? []).find((item: { type: string }) => item.type === 'output_text')?.text;
    const draft = JSON.parse(output ?? '');
    addExperiment(lab, { ...draft, owner: 'AI draft', data: '' });
    return json({ draft, latency_ms: Math.round(performance.now() - start), usage: result.usage?.total_tokens ?? null });
  } catch {
    return json({ error: 'Could not produce a valid draft. Include a date and exact resource quantities, or use the form. No changes were made.' }, { status: 502 });
  }
};
