<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue';
import { currentLocale, defineInternationalization, primaryLocale } from 'virtual:vue-internationalization';
import StaticPanel from './components/StaticPanel.vue';

defineInternationalization({
	'ja-JP': {
		scriptDefined: {
			title: 'script-defined locale message',
			greeting: (values?: { name?: string }) => `こんにちは ${values?.name ?? '名無し'}、script 内の関数翻訳です`,
		},
	},
	'en-US': {
		scriptDefined: {
			title: 'script-defined locale message',
			greeting: (values?: { name?: string }) => `Hello ${values?.name ?? 'there'}, this came from a script function`,
		},
	},
});

const AsyncPanel = defineAsyncComponent(() => import('./components/AsyncPanel.vue'));
const n = ref(3);
const scriptMessage = $locale.value.sfc.scriptMessage;
const scriptApples = computed(() => $l.value.sfc.nApples({ n: n.value }));
const previewListValues = ['SFC', 'local'];
const previewUser = 'vue-i18n';

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
    <section :class="$style.preview">
      <h2>{{ $locale.sfc.previewTitle }}</h2>
      <dl>
        <div>
          <dt>named</dt>
          <dd>{{ $l.sfc.preview.named({ 'user-name': previewUser }) }}</dd>
        </div>
        <div>
          <dt>list</dt>
          <dd>{{ $l.sfc.preview.list(previewListValues) }}</dd>
        </div>
        <div>
          <dt>literal</dt>
          <dd>{{ $l.sfc.preview.literal() }}</dd>
        </div>
        <div>
          <dt>plural</dt>
          <dd>{{ $l.sfc.preview.plural({ count: n }, n) }}</dd>
        </div>
        <div>
          <dt>linked</dt>
          <dd>{{ $l.sfc.preview.linked() }}</dd>
        </div>
        <div>
          <dt>{{ $locale.sfc.scriptDefined.title }}</dt>
          <dd>{{ $l.sfc.scriptDefined.greeting({ name: previewUser }) }}</dd>
        </div>
      </dl>
    </section>
    <p>{{ $locale.sfc.missingTranslation }}</p>
    <!-- @ts-expect-error: ts-plugin(2339) -->
    <p>{{ $locale.sfc.noTranslation }}</p>
    <button type="button" :disabled="n <= 0" @click="n--">-1</button>
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

.preview {
  margin-block: 24px;
}

.preview dl {
  display: grid;
  gap: 8px;
  margin: 0;
  max-width: 560px;
}

.preview dl > div {
  display: grid;
  gap: 12px;
  grid-template-columns: 96px 1fr;
}

.preview dt {
  color: #475569;
  font-weight: 700;
}

.preview dd {
  margin: 0;
}
</style>

<locale locale="ja-JP" lang="yaml">
title: ほげ
nApples: "{n} 個のりんご"
scriptMessage: script setup の中で参照した翻訳
previewTitle: message syntax preview
preview:
  named: "こんにちは {user-name}"
  list: "{0} と {1} の翻訳"
  literal: "{'@'} は linked message ではありません"
  plural: "りんごなし | りんごひとつ | りんご {count} 個"
  target: "リンク先メッセージ"
  linked: "@.upper:preview.target"
missingTranslation: 英語の翻訳がない
</locale>

<locale locale="en-US" lang="yaml">
title: foo
nApples: "{n} apples"
scriptMessage: Translation referenced inside script setup
previewTitle: message syntax preview
preview:
  named: "Hello {user-name}"
  list: "{0} and {1} translations"
  literal: "{'@'} is not a linked message"
  plural: "no apples | one apple | {count} apples"
  target: "linked message"
  linked: "@.capitalize:preview.target"
</locale>
