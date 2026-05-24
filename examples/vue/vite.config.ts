import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { vueInternationalization } from 'vite-vue-internationalization';

export default defineConfig({
	build: {
		manifest: true,
	},
	plugins: [
		vueInternationalization(),
		vue(),
	],
});
