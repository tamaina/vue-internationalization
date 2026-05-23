<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue';
import { currentLocale, primaryLocale } from 'virtual:vue-internationalization';
import StaticPanel from './components/StaticPanel.vue';

const AsyncPanel = defineAsyncComponent(() => import('./components/AsyncPanel.vue'));
const n = ref(3);
const scriptMessage = $locale.value.sfc.scriptMessage;
const scriptApples = computed(() => $l.value.sfc.nApples({ n: n.value }));

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
    <h1>{{ $locale.sfc.title }}</h1>
    <p>{{ $locale.env.fuga }}</p>
    <p>{{ $l.sfc.nApples({ n }) }}</p>
    <p>{{ scriptMessage }}</p>
    <p>{{ scriptApples }}</p>
    <p>{{ $locale.sfc.missingTranslation }}</p>
    <!-- @ts-expect-error: ts-plugin(2339) -->
    <p>{{ $locale.sfc.noTranslation }}</p>
    <button type="button" @click="n++">+1</button>
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
missingTranslation: 英語の翻訳がない
</locale>

<locale locale="en-US" lang="yaml">
title: foo
nApples: "{n} apples"
scriptMessage: Translation referenced inside script setup
</locale>
