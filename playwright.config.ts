import { defineConfig } from '@playwright/test';

const isCI = Boolean(process.env.CI);

export default defineConfig({
	testDir: 'test',
	testMatch: /examples-smoke\.spec\.ts/u,
	timeout: 30_000,
	expect: {
		timeout: 5_000,
	},
	use: {
		trace: 'on-first-retry',
	},
	webServer: [
		{
			command: 'pnpm --filter ./examples/vue dev -- --port 5173 --strictPort',
			url: 'http://127.0.0.1:5173/',
			reuseExistingServer: !isCI,
			timeout: 30_000,
		},
		{
			command: 'pnpm --filter ./examples/icu dev -- --port 5174 --strictPort',
			url: 'http://127.0.0.1:5174/',
			reuseExistingServer: !isCI,
			timeout: 30_000,
		},
		{
			command: 'pnpm --filter ./examples/vue exec vite preview --host 127.0.0.1 --port 4173 --strictPort',
			url: 'http://127.0.0.1:4173/',
			reuseExistingServer: !isCI,
			timeout: 30_000,
		},
		{
			command: 'pnpm --filter ./examples/icu exec vite preview --host 127.0.0.1 --port 4174 --strictPort',
			url: 'http://127.0.0.1:4174/',
			reuseExistingServer: !isCI,
			timeout: 30_000,
		},
	],
});
