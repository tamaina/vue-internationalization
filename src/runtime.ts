import { Fragment, computed, defineComponent, hasInjectionContext, h, inject, reactive } from 'vue';
import { compileLocaleMessage, formatLocaleMessage } from './message.js';
import type { App, ComputedRef, InjectionKey, PropType, VNodeChild } from 'vue';
import type { LocaleMessageSyntax, LocaleMessageToken, LocaleMessageValues } from './message.js';
import type { LocaleDictionary } from './types.js';

/** Runtime dictionary shape used by locale bundles. */
export type RuntimeLocaleDictionary = LocaleDictionary;
/** Combined locale scope exposed to components. */
export type LocaleScope<
	TGlobal extends RuntimeLocaleDictionary = RuntimeLocaleDictionary,
	TModule extends RuntimeLocaleDictionary = RuntimeLocaleDictionary,
> = {
	/** Global messages loaded from the plugin `global` option. */
	env: TGlobal;
	/** Messages owned by the current Vue SFC module. */
	sfc: TModule;
};
/** Primitive value accepted by the lightweight template formatter. */
export type LocaleTemplateValue = string | number | bigint | boolean | null | undefined | Date;
/** Named values accepted by the lightweight template formatter. */
export type LocaleTemplateValues = Record<string, LocaleTemplateValue>;
/** Function signature used by generated localizers. */
export type LocaleTemplateFunction = (values?: LocaleTemplateValues | LocaleTemplateValue[] | number, plural?: number) => string;
/** User-provided message function signature for programmatic dictionaries. */
export type LocaleMessageFunction<TValues = unknown> = {
	bivarianceHack(values?: TValues, plural?: number): string;
}['bivarianceHack'];
/** Names of the locale scopes available at runtime. */
export type InternationalizationScopeName = keyof LocaleScope;
/** Values accepted by date-time formatters. */
export type LocaleDateTimeValue = Date | number | string;
/** Values accepted by number formatters. */
export type LocaleNumberValue = number | bigint;
export type LocaleDateTimeFormatOptions = Intl.DateTimeFormatOptions;
export type LocaleNumberFormatOptions = Intl.NumberFormatOptions;
/** Date-time format presets keyed by locale and preset name. */
export type LocaleDateTimeFormatSource = Partial<Record<string, Record<string, LocaleDateTimeFormatOptions>>>;
/** Number format presets keyed by locale and preset name. */
export type LocaleNumberFormatSource = Partial<Record<string, Record<string, LocaleNumberFormatOptions>>>;
export type LocaleDateTimeFormatName = string;
export type LocaleNumberFormatName = string;
/** Formats a date-time value with either a preset name or inline Intl options. */
export type LocaleDateTimeFormatter = (
	value: LocaleDateTimeValue,
	format?: LocaleDateTimeFormatName | LocaleDateTimeFormatOptions,
	options?: LocaleDateTimeFormatOptions,
) => string;
/** Formats a number value with either a preset name or inline Intl options. */
export type LocaleNumberFormatter = (
	value: LocaleNumberValue,
	format?: LocaleNumberFormatName | LocaleNumberFormatOptions,
	options?: LocaleNumberFormatOptions,
) => string;
/** Localizer functions grouped by global and SFC scopes. */
export type LocaleLocalizerScope = {
	env: LocaleLocalizerDictionary;
	sfc: LocaleLocalizerDictionary;
};
/** Nested localizer dictionary returned by `$l` and localizer helpers. */
export interface LocaleLocalizerDictionary {
	[key: string]: LocaleTemplateFunction | LocaleMessageFunction | LocaleLocalizerDictionary;
}

/** Locale payload loaded for one locale. */
export type LocaleBundle = {
	global?: RuntimeLocaleDictionary;
	modules?: Partial<Record<string, RuntimeLocaleDictionary>>;
};

/** Async loader for a locale payload. */
export type LocaleLoader = () => Promise<LocaleBundle | { default: LocaleBundle }>;

/** Runtime options used to create an internationalization instance. */
export type InternationalizationRuntimeOptions = {
	/** Locale used as the primary fallback and generated type source. */
	primaryLocale: string;
	/** Locale to load first. Defaults to `primaryLocale`. */
	initialLocale?: string;
	/** Locale used when a message is missing from the active locale. */
	fallbackLocale?: string;
	/** Message parser used for string messages. */
	messageSyntax?: LocaleMessageSyntax;
	/** Locale bundle loaders keyed by locale code. */
	loaders: Partial<Record<string, LocaleLoader>>;
	/** Date-time format presets keyed by locale and preset name. */
	dateTimeFormats?: LocaleDateTimeFormatSource;
	/** Number format presets keyed by locale and preset name. */
	numberFormats?: LocaleNumberFormatSource;
};

/** Installed runtime instance shared through Vue provide/inject. */
export type InternationalizationInstance = {
	/** Currently loaded locale code. */
	locale: string;
	/** Primary locale code. */
	primaryLocale: string;
	/** Promise that settles after the initial locale load attempt. */
	ready: Promise<void>;
	/** Loads a locale bundle if it has not already been loaded. */
	loadLocale(locale: string): Promise<void>;
	/** Installs the instance into a Vue app. */
	install(app: App): void;
};

type InternationalizationState = {
	locale: string;
	primaryLocale: string;
	fallbackLocale: string;
	messageSyntax: LocaleMessageSyntax;
	bundles: Partial<Record<string, LocaleBundle>>;
	dateTimeFormats: LocaleDateTimeFormatSource;
	numberFormats: LocaleNumberFormatSource;
};

const INTERNATIONALIZATION_KEY: InjectionKey<InternationalizationInstance> = Symbol('vite-vue-internationalization');
const EMPTY_DICTIONARY: RuntimeLocaleDictionary = {};
const DICTIONARY_PROXY_CACHE = new WeakMap<RuntimeLocaleDictionary, WeakMap<RuntimeLocaleDictionary, Map<string, RuntimeLocaleDictionary>>>();
const LOCALIZER_PROXY_CACHE = new WeakMap<RuntimeLocaleDictionary, WeakMap<RuntimeLocaleDictionary, Map<string, LocaleLocalizerDictionary>>>();
const STATES = new WeakMap<InternationalizationInstance, InternationalizationState>();
let activeInternationalization: InternationalizationInstance | undefined;

/**
 * Vue component for component interpolation.
 *
 * It renders a message from either the `message` prop or a locale `scope` and
 * `path`, replacing named placeholders with matching slots when present.
 */
export const Internationalization = defineComponent({
	name: 'Internationalization',
	props: {
		message: {
			type: String,
			default: undefined,
		},
		locale: {
			type: Object as PropType<LocaleScope>,
			default: undefined,
		},
		scope: {
			type: String as PropType<InternationalizationScopeName>,
			default: 'sfc',
		},
		path: {
			type: String,
			default: undefined,
		},
		values: {
			type: [Object, Array, Number] as PropType<LocaleMessageValues | number>,
			default: undefined,
		},
		plural: {
			type: Number,
			default: undefined,
		},
	},
	setup(props, { slots }) {
		return () => h(Fragment, null, renderInternationalizationMessage({
			message: props.message,
			locale: props.locale,
			scope: props.scope,
			path: props.path,
			values: props.values,
			plural: props.plural,
			slots,
		}));
	},
});

/** Creates a runtime instance from explicit locale loaders and format presets. */
export function createInternationalization(options: InternationalizationRuntimeOptions): InternationalizationInstance {
	const state = reactive<InternationalizationState>({
		locale: options.initialLocale ?? options.primaryLocale,
		primaryLocale: options.primaryLocale,
		fallbackLocale: options.fallbackLocale ?? options.primaryLocale,
		messageSyntax: options.messageSyntax ?? 'vue',
		bundles: {},
		dateTimeFormats: options.dateTimeFormats ?? {},
		numberFormats: options.numberFormats ?? {},
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

/**
 * Defines programmatic locale dictionaries while preserving literal TypeScript
 * types for downstream extraction and component-level access.
 */
export function defineInternationalization<TMessages extends Partial<Record<string, RuntimeLocaleDictionary>>>(
	messages: TMessages,
): TMessages {
	return messages;
}

/** Sets the active instance used outside Vue injection context. */
export function setActiveInternationalization(instance: InternationalizationInstance): void {
	activeInternationalization = instance;
}

/** Returns the installed internationalization instance. */
export function useInternationalization(): InternationalizationInstance {
	const internationalization = hasInjectionContext()
		? inject(INTERNATIONALIZATION_KEY, activeInternationalization)
		: activeInternationalization;

	if (!internationalization) {
		throw new Error('vite-vue-internationalization is not installed. Call app.use(createInternationalization()).');
	}

	return internationalization;
}

/**
 * Returns reactive global and SFC dictionaries for the module identified by
 * `moduleUrl`.
 */
export function useLocale<
	TGlobal extends RuntimeLocaleDictionary = RuntimeLocaleDictionary,
	TModule extends RuntimeLocaleDictionary = RuntimeLocaleDictionary,
>(moduleUrl: string): Readonly<ComputedRef<LocaleScope<TGlobal, TModule>>> {
	const internationalization = useInternationalization();

	return computed(() => resolveLocale(internationalization, moduleUrl)) as ComputedRef<LocaleScope<TGlobal, TModule>>;
}

/** Returns reactive localizer functions for global and SFC dictionaries. */
export function useLocalizer(moduleUrl: string): Readonly<ComputedRef<LocaleLocalizerScope>> {
	const internationalization = useInternationalization();
	const locale = useLocale(moduleUrl);

	return computed(() => {
		const rootDictionary = locale.value as RuntimeLocaleDictionary;
		const state = getState(internationalization);

		return {
			env: createLocalizerDictionary(locale.value.env, ['env'], rootDictionary, state.locale, state.messageSyntax),
			sfc: createLocalizerDictionary(locale.value.sfc, ['sfc'], rootDictionary, state.locale, state.messageSyntax),
		};
	});
}

/**
 * Creates a lazy SFC dictionary proxy for component static `$locale` access.
 *
 * This is primarily used by generated component options.
 */
export function createComponentLocale<TModule extends RuntimeLocaleDictionary = RuntimeLocaleDictionary>(
	moduleUrl: string,
): TModule {
	return new Proxy({}, {
		get(_target, property) {
			if (typeof property !== 'string') {
				return undefined;
			}

			const internationalization = useInternationalization();
			return Reflect.get(resolveLocale(internationalization, moduleUrl).sfc, property);
		},
	}) as TModule;
}

/**
 * Creates a lazy SFC localizer proxy for component static `$l` access.
 *
 * This is primarily used by generated component options.
 */
export function createComponentLocalizer(moduleUrl: string): LocaleLocalizerDictionary {
	return new Proxy({}, {
		get(_target, property) {
			if (typeof property !== 'string') {
				return undefined;
			}

			const internationalization = useInternationalization();
			const locale = resolveLocale(internationalization, moduleUrl);
			const rootDictionary = locale as RuntimeLocaleDictionary;
			const state = getState(internationalization);
			const localizer = createLocalizerDictionary(locale.sfc, ['sfc'], rootDictionary, state.locale, state.messageSyntax);

			return Reflect.get(localizer, property);
		},
	}) as LocaleLocalizerDictionary;
}

/** Returns a formatter for the current locale's date-time presets. */
export function useDateTimeFormat(): Readonly<ComputedRef<LocaleDateTimeFormatter>> {
	const internationalization = useInternationalization();

	return computed(() => {
		const state = getState(internationalization);
		return (value, format, options) => formatDateTimeValue(state, value, format, options);
	});
}

/** Returns a formatter for the current locale's number presets. */
export function useNumberFormat(): Readonly<ComputedRef<LocaleNumberFormatter>> {
	const internationalization = useInternationalization();

	return computed(() => {
		const state = getState(internationalization);
		return (value, format, options) => formatNumberValue(state, value, format, options);
	});
}

/** Formats a lightweight Vue-style locale template with named values. */
export function formatLocaleTemplate(template: string, values: LocaleTemplateValues = {}): string {
	return formatLocaleMessage(template, { values });
}

function renderInternationalizationMessage(options: {
	message: string | undefined;
	locale: LocaleScope | undefined;
	scope: InternationalizationScopeName;
	path: string | undefined;
	values: LocaleMessageValues | number | undefined;
	plural: number | undefined;
	slots: Record<string, ((props: { text: string }) => VNodeChild) | undefined>;
}): VNodeChild[] {
	const message = options.message ?? getInternationalizationMessage(options.locale, options.scope, options.path);
	const normalizedValues = typeof options.values === 'number'
		? { count: options.values, n: options.values }
		: options.values;
	const normalizedPlural = typeof options.values === 'number' ? options.values : options.plural;
	const ast = compileLocaleMessage(message);
	const tokens = ast.cases[selectPluralCase(ast.cases.length, normalizedPlural)] ?? [];

	return tokens.flatMap((token) =>
		renderInternationalizationToken(token, {
			locale: options.locale,
			scope: options.scope,
			values: normalizedValues,
			plural: normalizedPlural,
			slots: options.slots,
		}));
}

function renderInternationalizationToken(
	token: LocaleMessageToken,
	context: {
		locale: LocaleScope | undefined;
		scope: InternationalizationScopeName;
		values: LocaleMessageValues | undefined;
		plural: number | undefined;
		slots: Record<string, ((props: { text: string }) => VNodeChild) | undefined>;
	},
): VNodeChild[] {
	switch (token.type) {
		case 'text':
			return [token.value];
		case 'named': {
			const text = formatInternationalizationNamedValue(token.key, context.values);
			const slot = context.slots[token.key];
			return slot ? asVNodeChildren(slot({ text })) : [text];
		}
		case 'list':
			return [formatInternationalizationListValue(token.index, context.values)];
		case 'literal':
			return [token.value];
		case 'linked':
			return [formatInternationalizationLinkedValue(token, context)];
	}
}

function getInternationalizationMessage(
	locale: LocaleScope | undefined,
	scope: InternationalizationScopeName,
	path: string | undefined,
): string {
	if (!locale || !path) {
		return path ? `$locale.${scope}.${path}` : '';
	}

	const value = getValueByPath(locale[scope], path.split('.'));
	return typeof value === 'string' ? value : `$locale.${scope}.${path}`;
}

function formatInternationalizationNamedValue(key: string, values: LocaleMessageValues | undefined): string {
	if (!values || Array.isArray(values)) {
		return `{${key}}`;
	}

	const value = values[key];
	return value == null ? `{${key}}` : String(value);
}

function formatInternationalizationListValue(index: number, values: LocaleMessageValues | undefined): string {
	if (!Array.isArray(values)) {
		return `{${index}}`;
	}

	const value = values[index];
	return value == null ? `{${index}}` : String(value);
}

function formatInternationalizationLinkedValue(
	token: Extract<LocaleMessageToken, { type: 'linked' }>,
	context: {
		locale: LocaleScope | undefined;
		scope: InternationalizationScopeName;
		values: LocaleMessageValues | undefined;
		plural: number | undefined;
	},
): string {
	const value = resolveInternationalizationLinkedMessage(context.locale, token.key, context.scope, context.values, context.plural)
		?? `@:${token.key}`;

	if (!token.modifier) {
		return value;
	}

	switch (token.modifier) {
		case 'upper':
			return value.toLocaleUpperCase();
		case 'lower':
			return value.toLocaleLowerCase();
		case 'capitalize':
			return value.charAt(0).toLocaleUpperCase() + value.slice(1);
		default:
			return value;
	}
}

function resolveInternationalizationLinkedMessage(
	locale: LocaleScope | undefined,
	key: string,
	scope: InternationalizationScopeName,
	values: LocaleMessageValues | undefined,
	plural: number | undefined,
	seen: Set<string> = new Set(),
): string | undefined {
	if (!locale) {
		return undefined;
	}

	const path = resolveLinkedPath(key, scope);
	const resolvedKey = path.join('.');

	if (seen.has(resolvedKey)) {
		return undefined;
	}

	const value = getValueByPath(locale, path);

	if (typeof value !== 'string') {
		return undefined;
	}

	seen.add(resolvedKey);
	return formatLocaleMessage(value, {
		values,
		plural,
		resolveLinked: (linkedKey) => resolveInternationalizationLinkedMessage(locale, linkedKey, path[0] as InternationalizationScopeName, values, plural, seen) ?? `@:${linkedKey}`,
	});
}

function selectPluralCase(length: number, plural: number | undefined): number {
	if (length <= 1) {
		return 0;
	}

	const choice = Math.abs(Math.trunc(plural ?? 1));
	const index = length === 2
		? choice === 1 ? 0 : 1
		: choice === 0 ? 0 : choice === 1 ? 1 : 2;

	return Math.min(index, length - 1);
}

function asVNodeChildren(value: VNodeChild): VNodeChild[] {
	return Array.isArray(value) ? value : [value];
}

function formatDateTimeValue(
	state: InternationalizationState,
	value: LocaleDateTimeValue,
	format: LocaleDateTimeFormatName | LocaleDateTimeFormatOptions | undefined,
	options: LocaleDateTimeFormatOptions | undefined,
): string {
	const { name, inlineOptions } = normalizeFormatArguments(format, options);
	const preset = name ? getNamedFormat(state.dateTimeFormats, state, name) : undefined;
	const date = typeof value === 'string' ? new Date(value) : value;

	return new Intl.DateTimeFormat(state.locale, {
		...preset,
		...inlineOptions,
	}).format(date);
}

function formatNumberValue(
	state: InternationalizationState,
	value: LocaleNumberValue,
	format: LocaleNumberFormatName | LocaleNumberFormatOptions | undefined,
	options: LocaleNumberFormatOptions | undefined,
): string {
	const { name, inlineOptions } = normalizeFormatArguments(format, options);
	const preset = name ? getNamedFormat(state.numberFormats, state, name) : undefined;

	return new Intl.NumberFormat(state.locale, {
		...preset,
		...inlineOptions,
	}).format(value);
}

function normalizeFormatArguments<TOptions extends object>(
	format: string | TOptions | undefined,
	options: TOptions | undefined,
): { name: string | undefined; inlineOptions: TOptions | undefined } {
	return typeof format === 'string'
		? { name: format, inlineOptions: options }
		: { name: undefined, inlineOptions: format };
}

function getNamedFormat<TOptions>(
	source: Partial<Record<string, Record<string, TOptions>>>,
	state: InternationalizationState,
	name: string,
): TOptions | undefined {
	return source[state.locale]?.[name]
		?? source[state.primaryLocale]?.[name]
		?? source[state.fallbackLocale]?.[name];
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
	locale?: string,
	messageSyntax: LocaleMessageSyntax = 'vue',
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
				return createLocalizerDictionary(value, nextPath, rootDictionary, locale, messageSyntax);
			}

			return (values?: LocaleTemplateValues | LocaleTemplateValue[] | number, plural?: number) => {
				const normalizedValues = typeof values === 'number' ? { count: values, n: values } : values;
				const normalizedPlural = typeof values === 'number' ? values : plural;

				if (typeof value === 'function') {
					return value(normalizedValues, normalizedPlural);
				}

				const message = typeof value === 'string' ? value : `$locale.${nextPath.join('.')}`;

				return formatLocaleMessage(message, {
					locale,
					syntax: messageSyntax,
					values: normalizedValues,
					plural: normalizedPlural,
					resolveLinked: (key) => resolveLinkedMessage(rootDictionary, key, normalizedValues, normalizedPlural, messageSyntax, undefined, path[0]),
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
	messageSyntax: LocaleMessageSyntax,
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
		syntax: messageSyntax,
		values,
		plural,
		resolveLinked: (linkedKey) => resolveLinkedMessage(dictionary, linkedKey, values, plural, messageSyntax, seen, path[0]),
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
		throw new Error('Invalid vite-vue-internationalization instance.');
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
