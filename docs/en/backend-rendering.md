# Backend HTML Rendering

VVI transforms Vue SFCs as a Vite plugin and provides the runtime module through `virtual:vite-vue-internationalization`. In environments that build backend code with Vite plugins, such as Cloudflare Workers, the same module graph can render Vue to an HTML string.

```ts
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createInternationalization } from 'virtual:vite-vue-internationalization';
import App from './App.vue';

export default {
  async fetch(request: Request) {
    const locale = new URL(request.url).searchParams.get('locale') ?? 'en-US';
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

For SSR, do not share the Vue app created by `createSSRApp()` or the installed VVI instance across requests. The example above creates an instance for each request with the selected locale passed as `initialLocale`, then calls `renderToString()` after `await internationalization.ready`. Locale dictionaries and loader definitions can live in module scope, but sharing the rendering app / instance can mix active locale state between concurrent requests.

`createInternationalization({ initialLocale })` loads only the locale bundle for `initialLocale`; it does not load every locale on every request. In the same Worker isolate, dynamically imported modules are normally cached, so repeated renders for the same locale should also avoid most module resolution cost. If rendering speed becomes a concern, avoid sharing the app / instance as an optimization. Cache request-independent layers instead, such as locale loaders or the final rendered HTML when the output is safe to reuse.

For Cloudflare Workers, register VVI with `@vitejs/plugin-vue` and `@cloudflare/vite-plugin`.

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

`inline-chunks` is an optimization for browser delivery that emits locale-specific chunks. For Workers or email-style backend rendering, start with the default `virtual` strategy.

See `examples/cloudflare-worker-ssr` for a small working example. For other SSR frameworks, check which layer owns Vite's SFC transform and resolution of `virtual:vite-vue-internationalization`. For example, Nuxt can use Vite as its build tool, but its server runtime is built around Nitro, so it should not be treated as the same setup as this Cloudflare Workers example.
