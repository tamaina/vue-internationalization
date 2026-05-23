import { computed, hasInjectionContext, inject, reactive } from 'vue';
import { formatLocaleMessage } from './message.js';
import type { App, ComputedRef, InjectionKey } from 'vue';
import type { LocaleMessageValues } from './message.js';
import type { LocaleDictionary } from './types.js';

export type RuntimeLocaleDictionary = LocaleDictionary;
export type LocaleScope<
	TGlobal extends RuntimeLocaleDictionary = RuntimeLocaleDictionary,
	TModule extends RuntimeLocaleDictionary = RuntimeLocaleDictionary,
> = {
	env: TGlobal;
	sfc: TModule;
};
export type LocaleTemplateValue = string | number | boolean | null | undefined;
export type LocaleTemplateValues = Record<string, LocaleTemplateValue>;
export type LocaleTemplateFunction = (values?: LocaleTemplateValues | LocaleTemplateValue[] | number, plural?: number) => string;
export type LocaleLocalizerScope = {
	env: LocaleLocalizerDictionary;
	sfc: LocaleLocalizerDictionary;
};
export interface LocaleLocalizerDictionary {
	[key: string]: LocaleTemplateFunction | LocaleLocalizerDictionary;
}

export type LocaleBundle = {
	global?: RuntimeLocaleDictionary;
	modules?: Partial<Record<string, RuntimeLocaleDictionary>>;
};

export type LocaleLoader = () => Promise<LocaleBundle | { default: LocaleBundle }>;

export type InternationalizationRuntimeOptions = {
	primaryLocale: string;
	initialLocale?: string;
	fallbackLocale?: string;
	loaders: Partial<Record<string, LocaleLoader>>;
};

export type InternationalizationInstance = {
	locale: string;
	primaryLocale: string;
	ready: Promise<void>;
	loadLocale(locale: string): Promise<void>;
	install(app: App): void;
};

type InternationalizationState = {
	locale: string;
	primaryLocale: string;
	fallbackLocale: string;
	bundles: Partial<Record<string, LocaleBundle>>;
};

const INTERNATIONALIZATION_KEY: InjectionKey<InternationalizationInstance> = Symbol('vue-internationalization');
const EMPTY_DICTIONARY: RuntimeLocaleDictionary = {};
const DICTIONARY_PROXY_CACHE = new WeakMap<RuntimeLocaleDictionary, WeakMap<RuntimeLocaleDictionary, Map<string, RuntimeLocaleDictionary>>>();
const LOCALIZER_PROXY_CACHE = new WeakMap<RuntimeLocaleDictionary, WeakMap<RuntimeLocaleDictionary, Map<string, LocaleLocalizerDictionary>>>();
const STATES = new WeakMap<InternationalizationInstance, InternationalizationState>();
let activeInternationalization: InternationalizationInstance | undefined;

export function createInternationalization(options: InternationalizationRuntimeOptions): InternationalizationInstance {
	const state = reactive<InternationalizationState>({
		locale: options.initialLocale ?? options.primaryLocale,
		primaryLocale: options.primaryLocale,
		fallbackLocale: options.fallbackLocale ?? options.primaryLocale,
		bundles: {},
	});

	const instance: InternationalizationInstance = {
		get locale() {
			return state.locale;
		},
		get primaryLocale() {
			return state.primaryLocale;
		},
		ready: Promise.resolve(),
		async loadLocale(locale) {
			if (state.bundles[locale]) {
				return;
			}

			const loader = options.loaders[locale];

			if (!loader) {
				throw new Error(`Locale "${locale}" is not available.`);
			}

			const loaded = await loader();
			const bundle = 'default' in loaded ? loaded.default : loaded;
			state.bundles[locale] = {
				global: bundle.global ?? {},
				modules: bundle.modules ?? {},
			};
		},
		install(app) {
			app.provide(INTERNATIONALIZATION_KEY, instance);
			setActiveInternationalization(instance);
		},
	};

	STATES.set(instance, state);
	instance.ready = instance.loadLocale(state.locale).catch((error) => {
		console.error(error);
	});

	return instance;
}

export function setActiveInternationalization(instance: InternationalizationInstance): void {
	activeInternationalization = instance;
}

export function useInternationalization(): InternationalizationInstance {
	const internationalization = hasInjectionContext()
		? inject(INTERNATIONALIZATION_KEY, activeInternationalization)
		: activeInternationalization;

	if (!internationalization) {
		throw new Error('vue-internationalization is not installed. Call app.use(createInternationalization()).');
	}

	return internationalization;
}

export function useLocale<
	TGlobal extends RuntimeLocaleDictionary = RuntimeLocaleDictionary,
	TModule extends RuntimeLocaleDictionary = RuntimeLocaleDictionary,
>(moduleUrl: string): Readonly<ComputedRef<LocaleScope<TGlobal, TModule>>> {
	const internationalization = useInternationalization();

	return computed(() => resolveLocale(internationalization, moduleUrl)) as ComputedRef<LocaleScope<TGlobal, TModule>>;
}

export function useLocalizer(moduleUrl: string): Readonly<ComputedRef<LocaleLocalizerScope>> {
	const locale = useLocale(moduleUrl);

	return computed(() => {
		const rootDictionary = locale.value as RuntimeLocaleDictionary;

		return {
			env: createLocalizerDictionary(locale.value.env, ['env'], rootDictionary),
			sfc: createLocalizerDictionary(locale.value.sfc, ['sfc'], rootDictionary),
		};
	});
}

export function formatLocaleTemplate(template: string, values: LocaleTemplateValues = {}): string {
	return formatLocaleMessage(template, { values });
}

function resolveLocale(internationalization: InternationalizationInstance, moduleUrl: string) {
	const state = getState(internationalization);
	const current = state.bundles[state.locale];
	const fallback = state.bundles[state.primaryLocale] ?? state.bundles[state.fallbackLocale];
	const moduleId = normalizeRuntimeModuleUrl(moduleUrl);

	return {
		env: createFallbackDictionary(current?.global, fallback?.global, 'env'),
		sfc: createFallbackDictionary(current?.modules?.[moduleId], fallback?.modules?.[moduleId], 'sfc'),
	};
}

function createFallbackDictionary(
	current: RuntimeLocaleDictionary | undefined,
	fallback: RuntimeLocaleDictionary | undefined,
	scope: string,
): RuntimeLocaleDictionary {
	return createDictionaryProxy(current ?? EMPTY_DICTIONARY, fallback ?? EMPTY_DICTIONARY, [scope]);
}

function createDictionaryProxy(
	current: RuntimeLocaleDictionary,
	fallback: RuntimeLocaleDictionary,
	path: string[],
): RuntimeLocaleDictionary {
	const cached = getDictionaryProxy(current, fallback, path);

	if (cached) {
		return cached;
	}

	const proxy = new Proxy(current, {
		get(target, property) {
			if (typeof property !== 'string') {
				return Reflect.get(target, property);
			}

			const value = getOwnValue(target, property);
			const fallbackValue = getOwnValue(fallback, property);
			const nextPath = [...path, property];

			if (isDictionary(value) || isDictionary(fallbackValue)) {
				return createDictionaryProxy(asDictionary(value), asDictionary(fallbackValue), nextPath);
			}

			return value ?? fallbackValue ?? `$locale.${nextPath.join('.')}`;
		},
	}) as RuntimeLocaleDictionary;

	setDictionaryProxy(current, fallback, path, proxy);
	return proxy;
}

function createLocalizerDictionary(
	dictionary: RuntimeLocaleDictionary,
	path: string[],
	rootDictionary: RuntimeLocaleDictionary = dictionary,
): LocaleLocalizerDictionary {
	const pathKey = path.join('.');
	const dictionaryCache = getOrCreateLocalizerCache(dictionary, rootDictionary);
	const cached = dictionaryCache.get(pathKey);

	if (cached) {
		return cached;
	}

	const proxy = new Proxy({}, {
		get(_target, property) {
			if (typeof property !== 'string') {
				return undefined;
			}

			const value = Reflect.get(dictionary, property) as unknown;
			const nextPath = [...path, property];

			if (isDictionary(value)) {
				return createLocalizerDictionary(value, nextPath, rootDictionary);
			}

			return (values?: LocaleTemplateValues | LocaleTemplateValue[] | number, plural?: number) => {
				const message = typeof value === 'string' ? value : `$locale.${nextPath.join('.')}`;
				const normalizedValues = typeof values === 'number' ? { count: values, n: values } : values;
				const normalizedPlural = typeof values === 'number' ? values : plural;

				return formatLocaleMessage(message, {
					values: normalizedValues,
					plural: normalizedPlural,
					resolveLinked: (key) => resolveLinkedMessage(rootDictionary, key, normalizedValues, normalizedPlural, undefined, path[0]),
				});
			};
		},
	}) as LocaleLocalizerDictionary;

	dictionaryCache.set(pathKey, proxy);
	return proxy;
}

function getDictionaryProxy(
	current: RuntimeLocaleDictionary,
	fallback: RuntimeLocaleDictionary,
	path: string[],
): RuntimeLocaleDictionary | undefined {
	return DICTIONARY_PROXY_CACHE.get(current)?.get(fallback)?.get(path.join('.'));
}

function setDictionaryProxy(
	current: RuntimeLocaleDictionary,
	fallback: RuntimeLocaleDictionary,
	path: string[],
	proxy: RuntimeLocaleDictionary,
): void {
	let fallbackCache = DICTIONARY_PROXY_CACHE.get(current);

	if (!fallbackCache) {
		fallbackCache = new WeakMap();
		DICTIONARY_PROXY_CACHE.set(current, fallbackCache);
	}

	let pathCache = fallbackCache.get(fallback);

	if (!pathCache) {
		pathCache = new Map();
		fallbackCache.set(fallback, pathCache);
	}

	pathCache.set(path.join('.'), proxy);
}

function getOrCreateLocalizerCache(
	dictionary: RuntimeLocaleDictionary,
	rootDictionary: RuntimeLocaleDictionary,
): Map<string, LocaleLocalizerDictionary> {
	let rootCache = LOCALIZER_PROXY_CACHE.get(dictionary);

	if (!rootCache) {
		rootCache = new WeakMap();
		LOCALIZER_PROXY_CACHE.set(dictionary, rootCache);
	}

	let cache = rootCache.get(rootDictionary);

	if (!cache) {
		cache = new Map();
		rootCache.set(rootDictionary, cache);
	}

	return cache;
}

function getOwnValue(dictionary: RuntimeLocaleDictionary, key: string): unknown {
	return Object.prototype.hasOwnProperty.call(dictionary, key) ? dictionary[key] : undefined;
}

function resolveLinkedMessage(
	dictionary: RuntimeLocaleDictionary,
	key: string,
	values: LocaleMessageValues | undefined,
	plural: number | undefined,
	seen: Set<string> = new Set(),
	scope: string | undefined = undefined,
): string {
	const path = resolveLinkedPath(key, scope);
	const resolvedKey = path.join('.');

	if (seen.has(resolvedKey)) {
		return `@:${key}`;
	}

	const value = getValueByPath(dictionary, path);
	if (typeof value !== 'string') {
		return `@:${key}`;
	}

	seen.add(resolvedKey);
	return formatLocaleMessage(value, {
		values,
		plural,
		resolveLinked: (linkedKey) => resolveLinkedMessage(dictionary, linkedKey, values, plural, seen, path[0]),
	});
}

function resolveLinkedPath(key: string, scope: string | undefined): string[] {
	const path = key.split('.');

	if (path[0] === 'env' || path[0] === 'sfc' || !scope) {
		return path;
	}

	return [scope, ...path];
}

function getValueByPath(dictionary: RuntimeLocaleDictionary, path: string[]): unknown {
	return path.reduce<unknown>((current, key) => {
		if (!isDictionary(current)) {
			return undefined;
		}

		return Reflect.get(current, key);
	}, dictionary);
}

function isDictionary(value: unknown): value is RuntimeLocaleDictionary {
	return value != null && typeof value === 'object' && !Array.isArray(value);
}

function asDictionary(value: unknown): RuntimeLocaleDictionary {
	return isDictionary(value) ? value : EMPTY_DICTIONARY;
}

function getState(internationalization: InternationalizationInstance): InternationalizationState {
	const state = STATES.get(internationalization);

	if (!state) {
		throw new Error('Invalid vue-internationalization instance.');
	}

	return state;
}

function normalizeRuntimeModuleUrl(moduleUrl: string): string {
	const withoutQuery = moduleUrl.split('?', 1)[0]?.replace(/\\/g, '/') ?? moduleUrl;

	try {
		return new URL(withoutQuery).pathname;
	} catch {
		return withoutQuery;
	}
}
