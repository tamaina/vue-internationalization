<template>
  <section :class="$style.panel">
    <h2>{{ $locale.sfc.heading }}</h2>
    <p>{{ $locale.sfc.body }}</p>
  </section>
</template>

<style module>
.panel {
  border: 1px solid #94a3b8;
  margin: 16px 0;
  padding: 12px;
}
</style>

<locale locale="ja-JP" lang="yaml">
heading: 静的コンポーネント
body: App.vue から静的に import された翻訳です。
</locale>

<locale locale="en-US" lang="yaml">
heading: Static component
body: This translation comes from a statically imported component.
</locale>
