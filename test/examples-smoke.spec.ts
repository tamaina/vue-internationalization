import { expect, test, type Page } from '@playwright/test';

type ExampleCase = {
	name: string;
	url: string;
	heading: string;
	bodyText: string;
	asyncText: string;
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
