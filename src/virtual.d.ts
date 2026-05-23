declare module 'virtual:vue-internationalization' {
	import type { InternationalizationInstance, LocaleLocalizerScope, LocaleScope, RuntimeLocaleDictionary } from 'vue-internationalization/runtime';
	import type { ComputedRef } from 'vue';

	export const primaryLocale: string;
	export const locales: string[];
	export const currentLocale: string;
	export function resolveInitialLocale(): string;
	export function createInternationalization(options?: {
		initialLocale?: string;
		fallbackLocale?: string;
	}): InternationalizationInstance;
	export function setActiveInternationalization(instance: InternationalizationInstance): void;
	export function useInternationalization(): InternationalizationInstance;
	export function useLocale<
		TGlobal extends RuntimeLocaleDictionary = RuntimeLocaleDictionary,
		TModule extends RuntimeLocaleDictionary = RuntimeLocaleDictionary,
	>(moduleUrl: string): Readonly<ComputedRef<LocaleScope<TGlobal, TModule>>>;
	export function useLocalizer(moduleUrl: string): Readonly<ComputedRef<LocaleLocalizerScope>>;
}
