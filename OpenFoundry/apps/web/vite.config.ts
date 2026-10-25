import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	// Plugin v4 predates Vite 6's explicit conditions. Retain browser exports
	// so client lifecycle hooks (including onMount) are not server no-ops.
	resolve: { conditions: ['browser', 'module', 'development|production'] },
});
