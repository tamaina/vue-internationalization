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
