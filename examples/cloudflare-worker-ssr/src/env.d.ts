/// <reference types="@cloudflare/workers-types" />
/// <reference types="vite-vue-internationalization/virtual" />

declare module '*.vue' {
	import type { DefineComponent } from 'vue';

	const component: DefineComponent<object, object, unknown>;
	export default component;
}
