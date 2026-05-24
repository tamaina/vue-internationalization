<script lang="ts">
import { defineInternationalization } from 'virtual:vite-vue-internationalization';

defineInternationalization({
	'ja-JP': {
		scriptDefined: {
			title: 'scriptでTypeScriptで定義されたコードです',
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
</script>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue';
import { currentLocale, primaryLocale } from 'virtual:vite-vue-internationalization';
import StaticPanel from './components/StaticPanel.vue';
import Messages from './messages.vue';

const AsyncPanel = defineAsyncComponent(() => import('./components/AsyncPanel.vue'));
const n = ref(3);
const scriptMessage = $locale.value.sfc.scriptMessage;
const scriptApples = computed(() => $l.value.sfc.nApples({ n: n.value }));
const staticPanelHeading = StaticPanel.$locale.heading;
const staticPanelBody = computed(() => StaticPanel.$l.body());
const localeOnlyTitle = Messages.$locale.title;
const localeOnlyBody = computed(() => Messages.$l.body({ source: 'messages.vue' }));
const previewUser = 'ICU';
const gender = 'female';

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
          <dd>{{ $l.sfc.preview.named({ name: previewUser }) }}</dd>
        </div>
        <div>
          <dt>argument</dt>
          <dd>{{ $l.sfc.preview.argument({ name: previewUser, count: n }) }}</dd>
        </div>
        <div>
          <dt>plural</dt>
          <dd>{{ $l.sfc.preview.plural({ count: n }) }}</dd>
        </div>
        <div>
          <dt>select</dt>
          <dd>{{ $l.sfc.preview.select({ gender, count: n }) }}</dd>
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
    <section :class="$style.preview">
      <h2>{{ $locale.sfc.componentExportTitle }}</h2>
      <p>{{ staticPanelHeading }}</p>
      <p>{{ staticPanelBody }}</p>
      <p>{{ localeOnlyTitle }}</p>
      <p>{{ localeOnlyBody }}</p>
    </section>
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
previewTitle: ICU MessageFormat preview
componentExportTitle: component export locale access
preview:
  named: "こんにちは {name}"
  argument: "{name} は {count} 個のりんごを見ています"
  plural: "{count, plural, =0 {りんごなし} one {りんごひとつ} other {りんご # 個}}"
  select: "{gender, select, female {彼女は {count, plural, one {りんごをひとつ} other {りんごを # 個}} 持っています} other {その人は {count, plural, one {りんごをひとつ} other {りんごを # 個}} 持っています}}"
missingTranslation: 英語の翻訳がない
</locale>

<locale locale="en-US" lang="yaml">
title: foo
nApples: "{n} apples"
scriptMessage: Translation referenced inside script setup
previewTitle: ICU MessageFormat preview
componentExportTitle: component export locale access
preview:
  named: "Hello {name}"
  argument: "{name} is looking at {count} apples"
  plural: "{count, plural, =0 {no apples} one {one apple} other {# apples}}"
  select: "{gender, select, female {She has {count, plural, one {one apple} other {# apples}}} other {They have {count, plural, one {one apple} other {# apples}}}}"
</locale>
