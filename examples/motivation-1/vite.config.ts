import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { vueInternationalization } from 'vue-internationalization';

export default defineConfig({
  plugins: [
    vueInternationalization({
      primaryLocale: 'ja-JP',
      global: {
        'ja-JP': './src/locales/ja-JP.yaml',
        'en-US': './src/locales/en-US.yaml'
      }
    }),
    vue()
  ]
});
