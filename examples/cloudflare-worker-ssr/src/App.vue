<script lang="ts">
import { defineInternationalization } from 'virtual:vite-vue-internationalization';

defineInternationalization({
	'ja-JP': {
		script: {
			subject: 'バックエンドで描画したメール',
			greeting: (values?: { name?: string }) => `${values?.name ?? '利用者'}さんへ`,
		},
	},
	'en-US': {
		script: {
			subject: 'Email rendered on the backend',
			greeting: (values?: { name?: string }) => `Hello ${values?.name ?? 'user'}`,
		},
	},
});
</script>

<script setup lang="ts">
const recipientName = 'VVI';
</script>

<template>
  <main>
    <p>{{ $l.sfc.script.greeting({ name: recipientName }) }}</p>
    <h1>{{ $locale.sfc.script.subject }}</h1>
    <p>{{ $locale.sfc.intro }}</p>
    <p>{{ $l.sfc.items({ count: 3 }, 3) }}</p>
    <p>{{ $l.sfc.footer({ service: 'Cloudflare Workers' }) }}</p>
  </main>
</template>

<locale locale="ja-JP" lang="yaml">
intro: Vite の SSR module graph で Vue SFC の翻訳を読み込んでいます。
items: "項目はありません | 項目が 1 件あります | 項目が {count} 件あります"
footer: "{service} から送信できます。"
</locale>

<locale locale="en-US" lang="yaml">
intro: Vue SFC translations are loaded through the Vite SSR module graph.
items: "No items | One item | {count} items"
footer: "Ready to send from {service}."
</locale>
