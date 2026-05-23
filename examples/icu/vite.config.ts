import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { vueInternationalization } from 'vue-internationalization';

export default defineConfig({
	build: {
		manifest: true,
	},
	plugins: [
		vueInternationalization({
			messageSyntax: 'icu',
		}),
		vue(),
	],
});
