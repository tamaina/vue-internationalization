# バックエンド HTML 描画

VVI は Vite プラグインとして Vue SFC を変換し、`virtual:vite-vue-internationalization` から runtime module を提供します。Cloudflare Workers のように Vite プラグインで Worker をビルドする環境では、同じ仕組みで Vue を HTML 文字列に描画できます。

```ts
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createInternationalization } from 'virtual:vite-vue-internationalization';
import App from './App.vue';

export default {
  async fetch(request: Request) {
    const locale = new URL(request.url).searchParams.get('locale') ?? 'ja-JP';
    const app = createSSRApp(App);
    const internationalization = createInternationalization({ initialLocale: locale });

    app.use(internationalization);
    await internationalization.ready;

    return new Response(await renderToString(app), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  },
};
```

SSR では `createSSRApp()` で作る Vue app と、その app に `install()` する VVI instance をリクエスト間で共有しないでください。上の例では、選択された locale を `initialLocale` に渡してリクエストごとに instance を作成し、`await internationalization.ready` の後で `renderToString()` を呼びます。辞書データや loader の定義は module scope に置けますが、描画中の app / instance を共有すると並行リクエストの locale が混ざる可能性があります。

`createInternationalization({ initialLocale })` は `initialLocale` の locale bundle だけを読み込みます。全 locale を毎回読み込むわけではありません。Worker の同じ isolate 内では dynamic import された module は通常キャッシュされるため、2 回目以降の同じ locale は module 解決のコストも小さくなります。速度が気になる場合でも、app / instance を共有して最適化するのではなく、locale loader や最終的な HTML など、リクエスト状態を持たない層でキャッシュしてください。

Cloudflare Workers では `@cloudflare/vite-plugin` と `@vitejs/plugin-vue` に加えて VVI を登録します。

```ts
import { cloudflare } from '@cloudflare/vite-plugin';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { vueInternationalization } from 'vite-vue-internationalization';

export default defineConfig({
  plugins: [
    vueInternationalization(),
    vue(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
  ],
});
```

`inline-chunks` はブラウザ配信用のチャンクを locale ごとに分ける最適化です。Worker やメール送信用のバックエンド描画では、まず標準の `virtual` 戦略を使ってください。

軽い動作例は `examples/cloudflare-worker-ssr` にあります。他の SSR フレームワークで使う場合は、そのフレームワークが Vite の SFC 変換と `virtual:vite-vue-internationalization` の解決をどの層で扱うかを確認してください。たとえば Nuxt は Vite をビルドツールとして使えますが、サーバー実行は Nitro の仕組みに乗るため、この Cloudflare Workers example と同じ構成としては扱いません。
