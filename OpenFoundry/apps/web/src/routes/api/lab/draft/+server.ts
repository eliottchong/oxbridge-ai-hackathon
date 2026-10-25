import { json } from '@sveltejs/kit';
export const POST = () => json({ error: { code: 'REPLACED', message: 'Use the authenticated protocol preflight workflow.' } }, { status: 410 });
