<template>
  <section :class="$style.panel">
    <h2>{{ $locale.sfc.heading }}</h2>
    <p>{{ $locale.sfc.body }}</p>
  </section>
</template>

<style module>
.panel {
  border: 1px dashed #64748b;
  margin: 16px 0;
  padding: 12px;
}
</style>

<locale locale="ja-JP" lang="yaml">
heading: 非同期コンポーネント
body: dynamic import された chunk 側の翻訳です。
</locale>

<locale locale="en-US" lang="yaml">
heading: Async component
body: This translation lives in a dynamically imported chunk.
</locale>
