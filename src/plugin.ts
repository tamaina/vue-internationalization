import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';
import {
	augmentViteManifestJson,
	getInlineLocaleHtmlLoaders,
	injectInlineLocaleBinding,
	createInlineLocaleMarker,
	inlineLocaleChunks,
	inlineLocaleHtml,
	replaceInlineLocalizerAccess,
	replaceInlineLocaleMemberAccess,
	replaceInlineLocaleHtml,
	replaceInlineLocaleMarkers,
	replaceInlineLocaleTextAccess,
	rewriteInlineComponentLocaleAccess,
	rewriteInlineLocaleTemplateAccess,
	type InlineChunkManifest,
} from './inline.js';
import {
	injectLocaleBinding,
	injectComponentLocaleOptions,
	getPrimaryLocaleDictionary,
	mergeLocaleDictionaries,
	parseLocaleDictionary,
	parseVueLocales,
	stripLocaleBlocks,
	transformVueSfc,
	validateLocaleDictionary,
} from './parse.js';
import { readTextFile, scanVueFiles, type ScanVueFilesOptions } from './files.js';
import { loadLocaleEnvDictionary, type LocaleEnvSource, type LocaleEnvSources } from './localeEnv.js';
import type { LocaleMessageSyntax } from './message.js';
import type { Plugin } from 'vite';
import type { LocaleDictionary } from './types.js';

export type { LocaleDictionary };

/** Locale dictionaries keyed by locale code. */
export type LocaleMessages = Partial<Record<string, LocaleDictionary>>;
export type { LocaleEnvSource, LocaleEnvSources };
/** Controls which Vue SFC files receive `$locale` and `$l` bindings. */
export type SfcTransformMode = 'locale-sources' | 'all';

/** Options for the Vite plugin and the matching Volar plugin configuration. */
export type VueInternationalizationOptions = {
	/** Locale used as the source of generated TypeScript types. */
	primaryLocale: string;
	/** Global dictionaries keyed by locale code. */
	global?: LocaleEnvSources;
	/** Controls whether locale payloads are loaded as virtual chunks or inlined into locale-specific chunks. */
	buildStrategy?: 'virtual' | 'inline-chunks';
	/** Glob filters used when collecting Vue files at startup. */
	scan?: ScanVueFilesOptions;
	/** Message parser used for string messages in the whole project. */
	messageSyntax?: LocaleMessageSyntax;
	/** Controls which Vue SFC files receive injected `$locale` and `$l` bindings. */
	sfcTransform?: SfcTransformMode;
};
type ResolvedVueInternationalizationOptions = VueInternationalizationOptions;
type TsconfigVueCompilerPlugin = {
	name?: unknown;
	primaryLocale?: unknown;
	global?: unknown;
	buildStrategy?: unknown;
	scan?: unknown;
	messageSyntax?: unknown;
	sfcTransform?: unknown;
};

type ModuleMessages = Partial<Record<string, LocaleMessages>>;

const VIRTUAL_ID = 'virtual:vite-vue-internationalization';
const RESOLVED_VIRTUAL_ID = `\0${VIRTUAL_ID}`;
const LOCALE_PREFIX = 'virtual:vite-vue-internationalization/locale/';
const RESOLVED_LOCALE_PREFIX = `\0${LOCALE_PREFIX}`;
const TSCONFIG_PLUGIN_NAMES = new Set(['vite-vue-internationalization', 'vite-vue-internationalization/volar']);

/**
 * Creates the Vite plugin that collects SFC locale blocks and script-defined
 * dictionaries, then exposes them through `virtual:vite-vue-internationalization`.
 *
 * When options are omitted, the plugin reads the matching
 * `vite-vue-internationalization/volar` entry from the Vite root `tsconfig.json`.
 */
export function vueInternationalization(options?: Partial<VueInternationalizationOptions>): Plugin {
	const modules: ModuleMessages = {};
	const globalMessages: LocaleMessages = {};
	let root = process.cwd();
	let command: 'build' | 'serve' = 'serve';
	let inlineManifest: InlineChunkManifest | undefined;
	let resolvedOptions: ResolvedVueInternationalizationOptions | undefined;
	let scanned = false;

	function collectVueFile(filename: string, code: string): void {
		const parsed = parseVueLocales(code, filename);

		if (parsed.blocks.length === 0 && Object.keys(parsed.scriptMessages).length === 0) {
			delete modules[toRuntimeModuleId(filename, root)];
			return;
		}

		const messages: LocaleMessages = {};

		for (const block of parsed.blocks) {
			messages[block.locale] = mergeLocaleDictionaries(
				messages[block.locale] ?? {},
				parseLocaleDictionary(block.content, block.lang, `${filename}<locale locale="${block.locale}">`),
			);
		}

		for (const [locale, dictionary] of Object.entries(parsed.scriptMessages)) {
			messages[locale] = mergeLocaleDictionaries(messages[locale] ?? {}, dictionary ?? {});
		}

		modules[toRuntimeModuleId(filename, root)] = messages;
	}

	function loadGlobalMessages(): void {
		for (const locale of Object.keys(globalMessages)) {
			delete globalMessages[locale];
		}

		const currentOptions = getResolvedOptions(resolvedOptions);

		if (!currentOptions.global) {
			return;
		}

		for (const [locale, value] of Object.entries(currentOptions.global)) {
			if (typeof value === 'string' || Array.isArray(value)) {
				globalMessages[locale] = loadLocaleEnvDictionary(root, locale, value);
				continue;
			}

			globalMessages[locale] = value;
		}
	}

	function scan(): void {
		loadGlobalMessages();

		for (const file of scanVueFiles(root, getResolvedOptions(resolvedOptions).scan)) {
			collectVueFile(file, readTextFile(file));
		}

		scanned = true;
	}

	function ensureScanned(): void {
		if (!scanned) {
			scan();
		}
	}

	return {
		name: 'vite-vue-internationalization',
		enforce: 'pre',
		configResolved(config) {
			root = config.root;
			command = config.command;
			resolvedOptions = resolveOptions(root, options);
		},
		buildStart() {
			scan();
		},
		resolveId(id) {
			if (id === VIRTUAL_ID) {
				return RESOLVED_VIRTUAL_ID;
			}

			if (id.startsWith(LOCALE_PREFIX)) {
				return `${RESOLVED_LOCALE_PREFIX}${id.slice(LOCALE_PREFIX.length)}`;
			}

			return null;
		},
		load(id) {
			ensureScanned();
			const currentOptions = getResolvedOptions(resolvedOptions);

			if (id === RESOLVED_VIRTUAL_ID) {
				if (command === 'build' && currentOptions.buildStrategy === 'inline-chunks') {
					return generateInlineRuntimeModule(currentOptions.primaryLocale, getLocales(modules, globalMessages), currentOptions.messageSyntax);
				}

				return generateRuntimeModule(currentOptions.primaryLocale, getLocales(modules, globalMessages), currentOptions.messageSyntax);
			}

			if (id.startsWith(RESOLVED_LOCALE_PREFIX)) {
				const locale = decodeURIComponent(id.slice(RESOLVED_LOCALE_PREFIX.length));
				return generateLocaleModule(locale, currentOptions.primaryLocale, modules, globalMessages);
			}

			return null;
		},
		transform(code, id) {
			if (!id.endsWith('.vue') || !existsSync(id)) {
				return null;
			}

			collectVueFile(id, code);
			const currentOptions = getResolvedOptions(resolvedOptions);
			const transformed =
				command === 'build' && currentOptions.buildStrategy === 'inline-chunks'
					? transformVueSfcInline(code, id, root, currentOptions.primaryLocale, currentOptions.sfcTransform === 'all')
					: transformVueSfc(code, id, {
						primaryLocale: currentOptions.primaryLocale,
						global: globalMessages[currentOptions.primaryLocale],
						messageSyntax: currentOptions.messageSyntax,
						transformAll: currentOptions.sfcTransform === 'all',
					});

			if (!transformed) {
				return null;
			}

			return {
				code: transformed,
				map: null,
			};
		},
		handleHotUpdate(context) {
			if (context.file.endsWith('.vue')) {
				collectVueFile(context.file, readTextFile(context.file));
			}
		},
		generateBundle(_outputOptions, bundle) {
			ensureScanned();
			const currentOptions = getResolvedOptions(resolvedOptions);

			if (currentOptions.buildStrategy === 'inline-chunks') {
				inlineManifest = inlineLocaleChunks(
					bundle as Record<string, unknown>,
					getLocales(modules, globalMessages),
					currentOptions.primaryLocale,
					modules,
					globalMessages,
					currentOptions.messageSyntax,
				);
				inlineLocaleHtml(bundle as Record<string, unknown>, inlineManifest);
			}
		},
		writeBundle(outputOptions, bundle) {
			const currentOptions = getResolvedOptions(resolvedOptions);

			if (currentOptions.buildStrategy !== 'inline-chunks' || !inlineManifest) {
				return;
			}

			inlineLocaleHtml(bundle as Record<string, unknown>, inlineManifest);
			rewriteWrittenHtml(resolve(root, outputOptions.dir ?? dirname(outputOptions.file ?? 'dist/index.js')), inlineManifest);
			rewriteWrittenViteManifest(resolve(root, outputOptions.dir ?? dirname(outputOptions.file ?? 'dist/index.js')), inlineManifest);
		},
	};
}

export const internals = {
	generateLocaleModule,
	generateInlineRuntimeModule,
	generateRuntimeModule,
	loadLocaleEnvDictionary,
	resolveOptions,
	augmentViteManifestJson,
	injectLocaleBinding,
	injectInlineLocaleBinding,
	inlineLocaleChunks,
	inlineLocaleHtml,
	replaceInlineLocalizerAccess,
	replaceInlineLocaleMemberAccess,
	replaceInlineLocaleHtml,
	replaceInlineLocaleMarkers,
	replaceInlineLocaleTextAccess,
	rewriteInlineComponentLocaleAccess,
	rewriteInlineLocaleTemplateAccess,
	stripLocaleBlocks,
	transformVueSfcInline,
};

function resolveOptions(root: string, options: Partial<VueInternationalizationOptions> | undefined): ResolvedVueInternationalizationOptions {
	const tsconfigOptions = readTsconfigOptions(root);
	const merged = {
		...tsconfigOptions,
		...options,
	};

	if (!merged.primaryLocale) {
		throw new Error(
			'vite-vue-internationalization requires a primaryLocale. Pass vueInternationalization({ primaryLocale }) or configure vueCompilerOptions.plugins in tsconfig.json.',
		);
	}

	return {
		primaryLocale: merged.primaryLocale,
		global: merged.global,
		buildStrategy: merged.buildStrategy,
		scan: merged.scan,
		messageSyntax: merged.messageSyntax ?? 'vue',
		sfcTransform: merged.sfcTransform ?? 'locale-sources',
	};
}

function readTsconfigOptions(root: string): Partial<VueInternationalizationOptions> {
	const file = resolve(root, 'tsconfig.json');

	if (!existsSync(file)) {
		return {};
	}

	const parsed = parseJsonFile(file);
	const plugins = getObject(parsed)?.vueCompilerOptions;
	const pluginList = getObject(plugins)?.plugins;

	if (!Array.isArray(pluginList)) {
		return {};
	}

	const plugin = pluginList
		.map((item) => getObject(item) as TsconfigVueCompilerPlugin | undefined)
		.find((item) => typeof item?.name === 'string' && TSCONFIG_PLUGIN_NAMES.has(item.name));

	if (!plugin) {
		return {};
	}

	return normalizeTsconfigPluginOptions(plugin, file);
}

function normalizeTsconfigPluginOptions(
	plugin: TsconfigVueCompilerPlugin,
	sourceFile: string,
): Partial<VueInternationalizationOptions> {
	const result: Partial<VueInternationalizationOptions> = {};

	if (typeof plugin.primaryLocale === 'string') {
		result.primaryLocale = plugin.primaryLocale;
	}

	if (plugin.global !== undefined) {
		result.global = normalizeGlobalOption(plugin.global, sourceFile);
	}

	if (plugin.buildStrategy === 'virtual' || plugin.buildStrategy === 'inline-chunks') {
		result.buildStrategy = plugin.buildStrategy;
	}

	if (plugin.scan !== undefined) {
		result.scan = normalizeScanOption(plugin.scan, sourceFile);
	}

	if (plugin.messageSyntax === 'vue' || plugin.messageSyntax === 'icu') {
		result.messageSyntax = plugin.messageSyntax;
	}

	if (plugin.sfcTransform === 'locale-sources' || plugin.sfcTransform === 'all') {
		result.sfcTransform = plugin.sfcTransform;
	}

	return result;
}

function normalizeScanOption(value: unknown, sourceFile: string): ScanVueFilesOptions {
	const scan = getObject(value);

	if (!scan) {
		throw new Error(`${sourceFile}: vite-vue-internationalization scan option must be an object.`);
	}

	const result: ScanVueFilesOptions = {};

	if (scan.include !== undefined) {
		result.include = normalizeStringOrStringArray(scan.include, `${sourceFile}: scan.include`);
	}

	if (scan.exclude !== undefined) {
		result.exclude = normalizeStringOrStringArray(scan.exclude, `${sourceFile}: scan.exclude`);
	}

	return result;
}

function normalizeGlobalOption(value: unknown, sourceFile: string): LocaleEnvSources {
	const global = getObject(value);

	if (!global) {
		throw new Error(`${sourceFile}: vite-vue-internationalization global option must be an object.`);
	}

	const result: LocaleEnvSources = {};

	for (const [locale, messages] of Object.entries(global)) {
		if (typeof messages === 'string' || isStringArray(messages)) {
			result[locale] = messages;
			continue;
		}

		result[locale] = normalizeLocaleDictionary(messages, `${sourceFile}: global.${locale}`);
	}

	return result;
}

function normalizeLocaleDictionary(value: unknown, sourceLabel: string): LocaleDictionary {
	const dictionary = getObject(value);

	if (!dictionary) {
		throw new Error(`${sourceLabel} must be an object or file path.`);
	}

	return validateLocaleDictionary(dictionary, sourceLabel);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function normalizeStringOrStringArray(value: unknown, sourceLabel: string): string | string[] {
	if (typeof value === 'string' || isStringArray(value)) {
		return value;
	}

	throw new Error(`${sourceLabel} must be a string or string array.`);
}

function parseJsonFile(file: string): unknown {
	const parsed = ts.parseConfigFileTextToJson(file, readFileSync(file, 'utf8'));

	if (parsed.error) {
		const message = ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n');
		throw new Error(`Failed to parse ${file}: ${message}`);
	}

	return parsed.config;
}

function getObject(value: unknown): Record<string, unknown> | undefined {
	return value != null && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}

function getResolvedOptions(options: ResolvedVueInternationalizationOptions | undefined): ResolvedVueInternationalizationOptions {
	if (!options) {
		throw new Error('vite-vue-internationalization options were used before Vite config was resolved.');
	}

	return options;
}

function getLocales(modules: ModuleMessages, global: LocaleMessages): string[] {
	const locales = new Set<string>(Object.keys(global));

	for (const moduleMessages of Object.values(modules)) {
		for (const locale of Object.keys(moduleMessages ?? {})) {
			locales.add(locale);
		}
	}

	return [...locales].sort();
}

function generateRuntimeModule(primaryLocale: string, locales: string[], messageSyntax: LocaleMessageSyntax = 'vue'): string {
	const loaders = Object.fromEntries(
		locales.map((locale) => [
			locale,
			`() => import(${JSON.stringify(`${LOCALE_PREFIX}${encodeURIComponent(locale)}`)})`,
		]),
	);

	const loaderEntries = Object.entries(loaders)
		.map(([locale, expression]) => `${JSON.stringify(locale)}: ${expression}`)
		.join(',\n  ');

	return [
		'import { Internationalization, createComponentLocale, createComponentLocalizer, createInternationalization as __createInternationalization, defineInternationalization, setActiveInternationalization, useDateTimeFormat, useInternationalization, useLocale, useLocalizer, useNumberFormat } from "vite-vue-internationalization/runtime";',
		`export const primaryLocale = ${JSON.stringify(primaryLocale)};`,
		`export const locales = ${JSON.stringify(locales)};`,
		`export const localeLoaders = {\n  ${loaderEntries}\n};`,
		'export function resolveInitialLocale() {',
		'  if (typeof window !== "undefined") {',
		'    const locale = new URL(window.location.href).searchParams.get("locale");',
		'    if (locale && locales.includes(locale)) return locale;',
		'  }',
		'  return primaryLocale;',
		'}',
		'export const currentLocale = resolveInitialLocale();',
		'export { Internationalization, createComponentLocale, createComponentLocalizer, defineInternationalization, setActiveInternationalization, useDateTimeFormat, useInternationalization, useLocale, useLocalizer, useNumberFormat };',
		'export function createInternationalization(options = {}) {',
		'  return __createInternationalization({',
		'    primaryLocale,',
		'    initialLocale: options.initialLocale ?? currentLocale,',
		'    loaders: localeLoaders,',
		'    fallbackLocale: options.fallbackLocale ?? primaryLocale,',
		`    messageSyntax: options.messageSyntax ?? ${JSON.stringify(messageSyntax)},`,
		'    dateTimeFormats: options.dateTimeFormats,',
		'    numberFormats: options.numberFormats',
		'  });',
		'}',
	].join('\n');
}

function generateInlineRuntimeModule(primaryLocale: string, locales: string[], messageSyntax: LocaleMessageSyntax = 'vue'): string {
	const loaderEntries = locales
		.map((locale) => `${JSON.stringify(locale)}: () => Promise.resolve({ global: {}, modules: {} })`)
		.join(',\n  ');

	return [
		'import { Internationalization, createComponentLocale, createComponentLocalizer, createInternationalization as __createInternationalization, defineInternationalization, setActiveInternationalization, useDateTimeFormat, useInternationalization, useLocale, useLocalizer, useNumberFormat } from "vite-vue-internationalization/runtime";',
		`export const primaryLocale = ${JSON.stringify(primaryLocale)};`,
		`export const locales = ${JSON.stringify(locales)};`,
		`export const localeLoaders = {\n  ${loaderEntries}\n};`,
		'export { Internationalization, createComponentLocale, createComponentLocalizer, defineInternationalization, setActiveInternationalization, useDateTimeFormat, useInternationalization, useLocale, useLocalizer, useNumberFormat };',
		'export function resolveInitialLocale() {',
		'  if (typeof window === "undefined") return primaryLocale;',
		'  const locale = new URL(window.location.href).searchParams.get("locale");',
		'  return locale && locales.includes(locale) ? locale : primaryLocale;',
		'}',
		'export const currentLocale = resolveInitialLocale();',
		'export function createInternationalization(options = {}) {',
		'  return __createInternationalization({',
		'    primaryLocale,',
		'    initialLocale: options.initialLocale ?? currentLocale,',
		'    loaders: localeLoaders,',
		'    fallbackLocale: options.fallbackLocale ?? primaryLocale,',
		`    messageSyntax: options.messageSyntax ?? ${JSON.stringify(messageSyntax)},`,
		'    dateTimeFormats: options.dateTimeFormats,',
		'    numberFormats: options.numberFormats',
		'  });',
		'}',
	].join('\n');
}

function generateLocaleModule(locale: string, primaryLocale: string, modules: ModuleMessages, global: LocaleMessages): string {
	const localeModules: Record<string, LocaleDictionary> = {};

	for (const [moduleId, messages] of Object.entries(modules)) {
		const module = mergeLocaleDictionaries(messages?.[primaryLocale] ?? {}, messages?.[locale] ?? {});

		if (Object.keys(module).length > 0) {
			localeModules[moduleId] = module;
		}
	}

	return [
		`export const locale = ${JSON.stringify(locale)};`,
		`export const global = ${serializeLocaleValue(mergeLocaleDictionaries(global[primaryLocale] ?? {}, global[locale] ?? {}))};`,
		`export const modules = ${serializeLocaleValue(localeModules)};`,
		'export default { locale, global, modules };',
	].join('\n');
}

function serializeLocaleValue(value: unknown): string {
	if (typeof value === 'function') {
		return `(${value.toString()})`;
	}

	if (Array.isArray(value)) {
		return `[${value.map((item) => serializeLocaleValue(item)).join(',')}]`;
	}

	if (value != null && typeof value === 'object') {
		return `{${Object.entries(value)
			.map(([key, child]) => `${toObjectPropertyName(key)}:${serializeLocaleValue(child)}`)
			.join(',')}}`;
	}

	return JSON.stringify(value);
}

function toObjectPropertyName(key: string): string {
	return JSON.stringify(key);
}

function toRuntimeModuleId(filename: string, root: string): string {
	const relativePath = relative(root, filename).replace(/\\/g, '/');
	return `/${relativePath}`;
}

function transformVueSfcInline(code: string, filename: string, root: string, primaryLocale?: string, transformAll = false): string | undefined {
	const parsed = parseVueLocales(code, filename);

	if (!transformAll && parsed.blocks.length === 0 && Object.keys(parsed.scriptMessages).length === 0) {
		return undefined;
	}

	const moduleId = toRuntimeModuleId(filename, root);
	const marker = createInlineLocaleMarker(moduleId);
	const stripped = stripLocaleBlocks(code, filename);
	const rewrittenComponentAccess = rewriteInlineComponentLocaleAccess(stripped, filename, root);
	const withSetupBinding = injectInlineLocaleBinding(rewriteInlineLocaleTemplateAccess(rewrittenComponentAccess, moduleId), moduleId);

	return injectComponentLocaleOptions(withSetupBinding, filename, {
		module: getPrimaryLocaleDictionary(parsed.blocks, primaryLocale, parsed.scriptMessages),
	}, {
		importLine: '',
		localeExpression: `__VUE_INTERNATIONALIZATION_INLINE_LOCALE__(${JSON.stringify(marker)}).sfc`,
		localizerExpression: `__VUE_INTERNATIONALIZATION_INLINE_LOCALIZERS__(${JSON.stringify(marker)}).sfc`,
	});
}

function rewriteWrittenHtml(outDir: string, manifest: InlineChunkManifest): void {
	const writtenLoaders = new Set<string>();

	for (const file of findHtmlFiles(outDir)) {
		const html = readFileSync(file, 'utf8');
		for (const loader of getInlineLocaleHtmlLoaders(html, manifest)) {
			if (writtenLoaders.has(loader.fileName)) {
				continue;
			}

			writeFileSync(resolve(outDir, loader.fileName), loader.source);
			writtenLoaders.add(loader.fileName);
		}

		const next = replaceInlineLocaleHtml(html, manifest);

		if (next !== html) {
			writeFileSync(file, next);
		}
	}
}

function rewriteWrittenViteManifest(outDir: string, manifest: InlineChunkManifest): void {
	for (const file of findManifestFiles(outDir)) {
		const source = readFileSync(file, 'utf8');
		const next = augmentViteManifestJson(source, manifest);

		if (next !== source) {
			writeFileSync(file, next);
		}
	}
}

function findHtmlFiles(dir: string): string[] {
	if (!existsSync(dir)) {
		return [];
	}

	const files: string[] = [];

	for (const entry of readdirSync(dir)) {
		const path = resolve(dir, entry);
		const stat = statSync(path);

		if (stat.isDirectory()) {
			files.push(...findHtmlFiles(path));
			continue;
		}

		if (stat.isFile() && path.endsWith('.html')) {
			files.push(path);
		}
	}

	return files;
}

function findManifestFiles(dir: string): string[] {
	if (!existsSync(dir)) {
		return [];
	}

	const files: string[] = [];

	for (const entry of readdirSync(dir)) {
		const path = resolve(dir, entry);
		const stat = statSync(path);

		if (stat.isDirectory()) {
			files.push(...findManifestFiles(path));
			continue;
		}

		if (stat.isFile() && path.endsWith('manifest.json')) {
			files.push(path);
		}
	}

	return files;
}
