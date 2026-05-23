<script setup lang="ts">
import { defineAsyncComponent } from 'vue';
import { currentLocale, primaryLocale } from 'virtual:vue-internationalization';
import StaticPanel from './components/StaticPanel.vue';

const AsyncPanel = defineAsyncComponent(() => import('./components/AsyncPanel.vue'));
const scriptMessage = $locale.value.module.scriptMessage;
const scriptApples = $l.value.module.nApples({ n: 3 });

function switchLocale(locale: string): void {
	const url = new URL(window.location.href);

	if (locale === primaryLocale) {
		url.searchParams.delete('locale');
	} else {
		url.searchParams.set('locale', locale);
	}

	window.location.assign(url);
}
</script>

<template>
  <main :class="$style.page">
    <h1>{{ $locale.module.title }}</h1>
    <p>{{ $locale.global.fuga }}</p>
    <p>{{ $l.module.nApples({ n: 3 }) }}</p>
    <p>{{ scriptMessage }}</p>
    <p>{{ scriptApples }}</p>
    <StaticPanel />
    <AsyncPanel />
    <button type="button" :disabled="currentLocale === 'ja-JP'" @click="switchLocale('ja-JP')">日本語</button>
    <button type="button" :disabled="currentLocale === 'en-US'" @click="switchLocale('en-US')">English</button>
  </main>
</template>

<style module>
.page {
  color: #172554;
  font-family: sans-serif;
  padding: 32px;
}
</style>

<locale locale="ja-JP" lang="yaml">
title: ほげ
nApples: "{n} 個のりんご"
scriptMessage: script setup の中で参照した翻訳
</locale>

<locale locale="en-US" lang="yaml">
title: foo
nApples: "{n} apples"
scriptMessage: Translation referenced inside script setup
</locale>
