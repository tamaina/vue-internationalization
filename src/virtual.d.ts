declare module 'virtual:vite-vue-internationalization' {
	import type { InternationalizationInstance, LocaleDateTimeFormatSource, LocaleDateTimeFormatter, LocaleLocalizerDictionary, LocaleLocalizerScope, LocaleNumberFormatSource, LocaleNumberFormatter, LocaleScope, RuntimeLocaleDictionary } from 'vite-vue-internationalization/runtime';
	import type { LocaleMessageSyntax } from 'vite-vue-internationalization';
	import type { ComputedRef } from 'vue';

	/** Locale used as the source of generated TypeScript types. */
	export const primaryLocale: string;
	/** Locale codes available in the generated runtime module. */
	export const locales: string[];
	/** Locale resolved from the current URL query or the primary locale. */
	export const currentLocale: string;
	/** Component used for slot-based interpolation of locale messages. */
	export const Internationalization: typeof import('vite-vue-internationalization/runtime').Internationalization;
	/** Defines programmatic locale dictionaries while preserving literal types. */
	export const defineInternationalization: typeof import('vite-vue-internationalization/runtime').defineInternationalization;
	/** Resolves the initial locale from the current URL query. */
	export function resolveInitialLocale(): string;
	/** Creates an internationalization instance with generated locale loaders. */
	export function createInternationalization(options?: {
		initialLocale?: string;
		fallbackLocale?: string;
		messageSyntax?: LocaleMessageSyntax;
		dateTimeFormats?: LocaleDateTimeFormatSource;
		numberFormats?: LocaleNumberFormatSource;
	}): InternationalizationInstance;
	/** Sets the active instance used outside Vue injection context. */
	export function setActiveInternationalization(instance: InternationalizationInstance): void;
	/** Returns the installed internationalization instance. */
	export function useInternationalization(): InternationalizationInstance;
	/** Returns reactive global and SFC dictionaries for the given module URL. */
	export function useLocale<
		TGlobal extends RuntimeLocaleDictionary = RuntimeLocaleDictionary,
		TModule extends RuntimeLocaleDictionary = RuntimeLocaleDictionary,
	>(moduleUrl: string): Readonly<ComputedRef<LocaleScope<TGlobal, TModule>>>;
	/** Returns reactive localizer functions for global and SFC dictionaries. */
	export function useLocalizer(moduleUrl: string): Readonly<ComputedRef<LocaleLocalizerScope>>;
	/** Creates a lazy SFC dictionary proxy for component static `$locale` access. */
	export function createComponentLocale<TModule extends RuntimeLocaleDictionary = RuntimeLocaleDictionary>(moduleUrl: string): TModule;
	/** Creates a lazy SFC localizer proxy for component static `$l` access. */
	export function createComponentLocalizer(moduleUrl: string): LocaleLocalizerDictionary;
	/** Returns a formatter for the current locale's date-time presets. */
	export function useDateTimeFormat(): Readonly<ComputedRef<LocaleDateTimeFormatter>>;
	/** Returns a formatter for the current locale's number presets. */
	export function useNumberFormat(): Readonly<ComputedRef<LocaleNumberFormatter>>;
}
