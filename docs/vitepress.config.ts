import { defineConfig } from 'vitepress';

export default defineConfig({
	base: '/vite-vue-internationalization/',
	title: 'vite-vue-internationalization',
	description: 'Typed internationalization for Vue SFCs',
	lastUpdated: true,
	cleanUrls: true,
	themeConfig: {
		search: {
			provider: 'local',
		},
		socialLinks: [
			{ icon: 'github', link: 'https://github.com/tamaina/vite-vue-internationalization' },
		],
	},
	locales: {
		root: {
			label: '日本語',
			lang: 'ja-JP',
			title: 'vite-vue-internationalization',
			description: 'Vue SFC のための型付き国際化',
			themeConfig: {
				nav: [
					{ text: 'ガイド', link: '/getting-started' },
					{ text: 'API', link: '/api' },
					{ text: 'npm', link: 'https://www.npmjs.com/package/vite-vue-internationalization' },
				],
				sidebar: [
					{ text: 'トップ', link: '/' },
					{ text: 'はじめる', link: '/getting-started' },
					{ text: '設定', link: '/configuration' },
					{ text: 'メッセージ定義', link: '/messages' },
					{ text: 'メッセージ構文', link: '/message-syntax' },
					{ text: 'ビルド戦略', link: '/build-strategy' },
					{ text: 'バックエンド HTML 描画', link: '/backend-rendering' },
					{ text: 'API リファレンス', link: '/api' },
				],
			},
		},
		en: {
			label: 'English',
			lang: 'en-US',
			title: 'vite-vue-internationalization',
			description: 'Typed internationalization for Vue SFCs',
			link: '/en/',
			themeConfig: {
				nav: [
					{ text: 'Guide', link: '/en/getting-started' },
					{ text: 'API', link: '/api' },
					{ text: 'npm', link: 'https://www.npmjs.com/package/vite-vue-internationalization' },
				],
				sidebar: [
					{ text: 'Home', link: '/en/' },
					{ text: 'Getting Started', link: '/en/getting-started' },
					{ text: 'Configuration', link: '/en/configuration' },
					{ text: 'Messages', link: '/en/messages' },
					{ text: 'Message Syntax', link: '/en/message-syntax' },
					{ text: 'Build Strategy', link: '/en/build-strategy' },
					{ text: 'Backend HTML Rendering', link: '/en/backend-rendering' },
					{ text: 'API Reference', link: '/api' },
				],
			},
		},
	},
});
