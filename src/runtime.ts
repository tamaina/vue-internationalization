import { computed, hasInjectionContext, inject, reactive } from 'vue';
import type { App, ComputedRef, InjectionKey } from 'vue';
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
export type LocaleTemplateFunction = (values?: LocaleTemplateValues) => string;
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
const TEMPLATE_CACHE_LIMIT = 500;
const TEMPLATE_TOKEN_RE = /\{([A-Za-z_$][\w$]*)\}/g;
const TEMPLATE_TOKEN_CACHE = new Map<string, TemplateToken[]>();
const DICTIONARY_PROXY_CACHE = new WeakMap<RuntimeLocaleDictionary, WeakMap<RuntimeLocaleDictionary, Map<string, RuntimeLocaleDictionary>>>();
const LOCALIZER_PROXY_CACHE = new WeakMap<RuntimeLocaleDictionary, Map<string, LocaleLocalizerDictionary>>();
const STATES = new WeakMap<InternationalizationInstance, InternationalizationState>();
let activeInternationalization: InternationalizationInstance | undefined;

type TemplateToken = string | { key: string };

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

	return computed(() => ({
		env: createLocalizerDictionary(locale.value.env, ['env']),
		sfc: createLocalizerDictionary(locale.value.sfc, ['sfc']),
	}));
}

export function formatLocaleTemplate(template: string, values: LocaleTemplateValues = {}): string {
	const tokens = getTemplateTokens(template);

	if (tokens.length === 1 && tokens[0] === template) {
		return template;
	}

	return tokens.map((token) => {
		if (typeof token === 'string') {
			return token;
		}

		const value = values[token.key];
		return value == null ? `{${token.key}}` : String(value);
	}).join('');
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

function createLocalizerDictionary(dictionary: RuntimeLocaleDictionary, path: string[]): LocaleLocalizerDictionary {
	const pathKey = path.join('.');
	const dictionaryCache = getOrCreateLocalizerCache(dictionary);
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
				return createLocalizerDictionary(value, nextPath);
			}

			return (values?: LocaleTemplateValues) => formatLocaleTemplate(
				typeof value === 'string' ? value : `$locale.${nextPath.join('.')}`,
				values,
			);
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

function getOrCreateLocalizerCache(dictionary: RuntimeLocaleDictionary): Map<string, LocaleLocalizerDictionary> {
	let cache = LOCALIZER_PROXY_CACHE.get(dictionary);

	if (!cache) {
		cache = new Map();
		LOCALIZER_PROXY_CACHE.set(dictionary, cache);
	}

	return cache;
}

function getTemplateTokens(template: string): TemplateToken[] {
	const cached = TEMPLATE_TOKEN_CACHE.get(template);

	if (cached) {
		return cached;
	}

	const tokens = compileTemplate(template);

	if (TEMPLATE_TOKEN_CACHE.size >= TEMPLATE_CACHE_LIMIT) {
		const oldestKey = TEMPLATE_TOKEN_CACHE.keys().next().value;

		if (oldestKey !== undefined) {
			TEMPLATE_TOKEN_CACHE.delete(oldestKey);
		}
	}

	TEMPLATE_TOKEN_CACHE.set(template, tokens);
	return tokens;
}

function compileTemplate(template: string): TemplateToken[] {
	const tokens: TemplateToken[] = [];
	let cursor = 0;

	for (const match of template.matchAll(TEMPLATE_TOKEN_RE)) {
		const index = match.index;
		const key = match[1];

		if (!key) {
			continue;
		}

		if (index > cursor) {
			tokens.push(template.slice(cursor, index));
		}

		tokens.push({ key });
		cursor = index + match[0].length;
	}

	if (cursor < template.length) {
		tokens.push(template.slice(cursor));
	}

	return tokens.length === 0 ? [template] : tokens;
}

function getOwnValue(dictionary: RuntimeLocaleDictionary, key: string): unknown {
	return Object.prototype.hasOwnProperty.call(dictionary, key) ? dictionary[key] : undefined;
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
