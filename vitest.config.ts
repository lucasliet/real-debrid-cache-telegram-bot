import { fileURLToPath } from 'node:url';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Tests run inside workerd, the same runtime as production. Remote bindings (Workers AI) are turned off:
// tests inject a stand-in for the model, so they need neither credentials nor network.
export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: './wrangler.jsonc' },
			remoteBindings: false,
		}),
	],
	resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
	test: { include: ['tests/**/*.test.ts'] },
});
