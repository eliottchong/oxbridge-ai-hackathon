import { spawn } from 'node:child_process';

// The event network resets Node's TLS connection to Google, while the system
// client works. Keep TLS verification on and pass credentials over stdin only.
export const geminiTransport: typeof fetch = async (input, init = {}) => {
  const url = String(input);
  if (!url.startsWith('https://generativelanguage.googleapis.com/v1beta/models/')) return fetch(input, init);
  if (init.method !== 'POST' || typeof init.body !== 'string') throw new Error('Expected a Google JSON POST.');
  const headers = new Headers(init.headers);
  const config = ['request = "POST"', ...Array.from(headers, ([name, value]) => `header = ${JSON.stringify(name + ': ' + value)}`),
    `data = ${JSON.stringify(init.body)}`].join('\n') + '\n';
  return new Promise<Response>((resolve, reject) => {
    const child = spawn('/usr/bin/curl', ['--silent', '--show-error', '--max-time', '15', '--proto', '=https',
      '--config', '-', '--write-out', '\n%{http_code}', url], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', settled = false;
    const finish = (error?: Error, response?: Response) => {
      if (settled) return;
      settled = true;
      init.signal?.removeEventListener('abort', abort);
      if (error) { child.kill(); reject(error); } else resolve(response!);
    };
    const abort = () => finish(new DOMException('Google request aborted.', 'AbortError'));
    child.on('error', () => finish(new Error('System HTTP client unavailable.')));
    child.stdin.on('error', () => finish(new Error('System HTTP request failed.')));
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      if (output.length > 200004) finish(new Error('Google response too large.'));
    });
    child.stderr.resume(); // Never expose request credentials or task data in logs.
    child.on('close', code => {
      if (code === 28) return finish(new DOMException('Google request timed out.', 'TimeoutError'));
      if (code !== 0) return finish(new Error('Google connection failed.'));
      const split = output.lastIndexOf('\n');
      const status = Number(output.slice(split + 1));
      if (split < 0 || status < 200 || status > 599) return finish(new Error('Invalid Google HTTP response.'));
      finish(undefined, new Response(output.slice(0, split), { status, headers: { 'content-type': 'application/json' } }));
    });
    init.signal?.addEventListener('abort', abort, { once: true });
    if (init.signal?.aborted) return abort();
    child.stdin.end(config);
  });
};
