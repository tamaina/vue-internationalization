<template>
  <main :class="$style.page">
    <h1>{{ $locale.module.title }}</h1>
    <p>{{ $locale.global.fuga }}</p>
    <p>{{ $locale.module.nApples }}</p>
    <button type="button" @click="$setLocale('ja-JP')">日本語</button>
    <button type="button" @click="$setLocale('en-US')">English</button>
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
nApples: 3 個のりんご
</locale>

<locale locale="en-US" lang="yaml">
title: foo
nApples: 3 apples
</locale>
