import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createInternationalization, locales, primaryLocale } from 'virtual:vite-vue-internationalization';
import App from './App.vue';

export default {
	async fetch(request) {
		const initialLocale = resolveRequestLocale(request);
		const app = createSSRApp(App);
		const internationalization = createInternationalization({ initialLocale });

		app.use(internationalization);
		await internationalization.ready;

		const body = await renderToString(app);

		return new Response(renderDocument(body, initialLocale), {
			headers: {
				'content-type': 'text/html; charset=utf-8',
			},
		});
	},
} satisfies ExportedHandler;

function resolveRequestLocale(request: Request): string {
	const url = new URL(request.url);
	const queryLocale = url.searchParams.get('locale');

	if (queryLocale && locales.includes(queryLocale)) {
		return queryLocale;
	}

	for (const accepted of parseAcceptedLocales(request.headers.get('accept-language'))) {
		const matched = locales.find((locale) => locale === accepted || locale.split('-', 1)[0] === accepted);

		if (matched) {
			return matched;
		}
	}

	return primaryLocale;
}

function parseAcceptedLocales(header: string | null): string[] {
	return (header ?? '')
		.split(',')
		.map((part) => part.trim().split(';', 1)[0]?.toLowerCase())
		.filter((locale): locale is string => Boolean(locale));
}

function renderDocument(body: string, locale: string): string {
	return `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head>
  <meta charset="utf-8">
  <title>VVI Cloudflare Workers SSR</title>
</head>
<body>${body}</body>
</html>`;
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (char) => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		'\'': '&#39;',
	})[char] ?? char);
}
