import { expect, test, type Page } from '@playwright/test';

type ExampleCase = {
	name: string;
	url: string;
	heading: string;
	bodyText: string;
	asyncText: string;
};

type WorkerSsrExampleCase = {
	name: string;
	url: string;
	lang: string;
	heading: string;
	bodyText: string;
	footerText: string;
};

const examples: ExampleCase[] = [
	{
		name: 'vue dev ja',
		url: 'http://127.0.0.1:5173/',
		heading: 'ほげ',
		bodyText: 'こんにちは vue-i18n',
		asyncText: '非同期コンポーネント',
	},
	{
		name: 'vue dev en',
		url: 'http://127.0.0.1:5173/?locale=en-US',
		heading: 'foo',
		bodyText: 'Hello vue-i18n',
		asyncText: 'Async component',
	},
	{
		name: 'icu dev ja',
		url: 'http://127.0.0.1:5174/',
		heading: 'ほげ',
		bodyText: 'こんにちは ICU',
		asyncText: '非同期コンポーネント',
	},
	{
		name: 'icu dev en',
		url: 'http://127.0.0.1:5174/?locale=en-US',
		heading: 'foo',
		bodyText: 'Hello ICU',
		asyncText: 'Async component',
	},
	{
		name: 'vue preview ja',
		url: 'http://127.0.0.1:4173/',
		heading: 'ほげ',
		bodyText: 'こんにちは vue-i18n',
		asyncText: '非同期コンポーネント',
	},
	{
		name: 'vue preview en',
		url: 'http://127.0.0.1:4173/?locale=en-US',
		heading: 'foo',
		bodyText: 'Hello vue-i18n',
		asyncText: 'Async component',
	},
	{
		name: 'icu preview ja',
		url: 'http://127.0.0.1:4174/',
		heading: 'ほげ',
		bodyText: 'こんにちは ICU',
		asyncText: '非同期コンポーネント',
	},
	{
		name: 'icu preview en',
		url: 'http://127.0.0.1:4174/?locale=en-US',
		heading: 'foo',
		bodyText: 'Hello ICU',
		asyncText: 'Async component',
	},
];

const workerSsrExamples: WorkerSsrExampleCase[] = [
	{
		name: 'cloudflare worker ssr ja',
		url: 'http://127.0.0.1:4175/?locale=ja-JP',
		lang: 'ja-JP',
		heading: 'バックエンドで描画したメール',
		bodyText: 'Vite の SSR module graph で Vue SFC の翻訳を読み込んでいます。',
		footerText: 'Cloudflare Workers から送信できます。',
	},
	{
		name: 'cloudflare worker ssr en',
		url: 'http://127.0.0.1:4175/?locale=en-US',
		lang: 'en-US',
		heading: 'Email rendered on the backend',
		bodyText: 'Vue SFC translations are loaded through the Vite SSR module graph.',
		footerText: 'Ready to send from Cloudflare Workers.',
	},
];

for (const example of examples) {
	test(`${example.name} renders localized content`, async ({ page }) => {
		const problems = collectPageProblems(page);

		await page.goto(example.url, { waitUntil: 'networkidle' });

		await expect(page.locator('#app')).not.toBeEmpty();
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(example.heading);
		await expect(page.getByText(example.bodyText, { exact: true })).toBeVisible();
		await expect(page.getByText(example.asyncText, { exact: true })).toBeVisible();

		expect(problems).toEqual([]);
	});
}

for (const example of workerSsrExamples) {
	test(`${example.name} renders localized html`, async ({ page }) => {
		const problems = collectPageProblems(page);

		await page.goto(example.url, { waitUntil: 'networkidle' });

		await expect(page.locator('html')).toHaveAttribute('lang', example.lang);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(example.heading);
		await expect(page.getByText(example.bodyText, { exact: true })).toBeVisible();
		await expect(page.getByText(example.footerText, { exact: true })).toBeVisible();
		await expect(page.locator('#app')).toHaveCount(0);

		expect(problems).toEqual([]);
	});
}

function collectPageProblems(page: Page): string[] {
	const problems: string[] = [];

	page.on('console', (message) => {
		if (message.type() === 'error') {
			problems.push(`console error: ${message.text()}`);
		}
	});

	page.on('pageerror', (error) => {
		problems.push(`page error: ${error.message}`);
	});

	page.on('requestfailed', (request) => {
		problems.push(`request failed: ${request.url()} ${request.failure()?.errorText ?? ''}`.trim());
	});

	page.on('response', (response) => {
		if (response.status() >= 400) {
			problems.push(`http ${response.status()}: ${response.url()}`);
		}
	});

	return problems;
}
