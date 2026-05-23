import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import ts from 'typescript';
import {
	augmentViteManifestJson,
	injectInlineLocaleBinding,
	inlineLocaleChunks,
	inlineLocaleHtml,
	replaceInlineLocaleMemberAccess,
	replaceInlineLocaleHtml,
	replaceInlineLocaleTextAccess,
	rewriteInlineLocaleTemplateAccess,
	type InlineChunkManifest,
} from './inline.js';
import {
	injectLocaleBinding,
	parseLocaleDictionary,
	parseVueLocales,
	stripLocaleBlocks,
	transformVueSfc,
} from './parse.js';
import { readTextFile, scanVueFiles } from './files.js';
import type { Plugin } from 'vite';
import type { LocaleDictionary } from './types.js';

export type { LocaleDictionary };

export type LocaleMessages = Partial<Record<string, LocaleDictionary>>;

export type VueInternationalizationOptions = {
	primaryLocale: string;
	global?: LocaleMessages | Record<string, string>;
	buildStrategy?: 'virtual' | 'inline-chunks';
};
type ResolvedVueInternationalizationOptions = VueInternationalizationOptions;
type TsconfigVueCompilerPlugin = {
	name?: unknown;
	primaryLocale?: unknown;
	global?: unknown;
	buildStrategy?: unknown;
};

type ModuleMessages = Partial<Record<string, LocaleMessages>>;

const VIRTUAL_ID = 'virtual:vue-internationalization';
const RESOLVED_VIRTUAL_ID = `\0${VIRTUAL_ID}`;
const LOCALE_PREFIX = 'virtual:vue-internationalization/locale/';
const RESOLVED_LOCALE_PREFIX = `\0${LOCALE_PREFIX}`;
const TSCONFIG_PLUGIN_NAMES = new Set(['vue-internationalization', 'vue-internationalization/volar']);

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

		if (parsed.blocks.length === 0) {
			delete modules[toRuntimeModuleId(filename, root)];
			return;
		}

		const messages: LocaleMessages = {};

		for (const block of parsed.blocks) {
			messages[block.locale] = {
				...(messages[block.locale] ?? {}),
				...parseLocaleDictionary(block.content, block.lang, `${filename}<locale locale="${block.locale}">`),
			};
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
			if (typeof value === 'string') {
				const file = isAbsolute(value) ? value : resolve(root, value);
				const lang = file.endsWith('.json') ? 'json' : 'yaml';
				globalMessages[locale] = parseLocaleDictionary(readFileSync(file, 'utf8'), lang, file);
				continue;
			}

			globalMessages[locale] = value;
		}
	}

	function scan(): void {
		loadGlobalMessages();

		for (const file of scanVueFiles(root)) {
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
		name: 'vue-internationalization',
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
					return generateInlineRuntimeModule(currentOptions.primaryLocale, getLocales(modules, globalMessages));
				}

				return generateRuntimeModule(currentOptions.primaryLocale, getLocales(modules, globalMessages));
			}

			if (id.startsWith(RESOLVED_LOCALE_PREFIX)) {
				const locale = decodeURIComponent(id.slice(RESOLVED_LOCALE_PREFIX.length));
				return generateLocaleModule(locale, modules, globalMessages);
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
					? transformVueSfcInline(code, id, root)
					: transformVueSfc(code, id, {
						primaryLocale: currentOptions.primaryLocale,
						global: globalMessages[currentOptions.primaryLocale],
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
	resolveOptions,
	augmentViteManifestJson,
	injectLocaleBinding,
	injectInlineLocaleBinding,
	inlineLocaleChunks,
	inlineLocaleHtml,
	replaceInlineLocaleMemberAccess,
	replaceInlineLocaleHtml,
	replaceInlineLocaleTextAccess,
	rewriteInlineLocaleTemplateAccess,
	stripLocaleBlocks,
};

function resolveOptions(root: string, options: Partial<VueInternationalizationOptions> | undefined): ResolvedVueInternationalizationOptions {
	const tsconfigOptions = readTsconfigOptions(root);
	const merged = {
		...tsconfigOptions,
		...options,
	};

	if (!merged.primaryLocale) {
		throw new Error(
			'vue-internationalization requires a primaryLocale. Pass vueInternationalization({ primaryLocale }) or configure vueCompilerOptions.plugins in tsconfig.json.',
		);
	}

	return {
		primaryLocale: merged.primaryLocale,
		global: merged.global,
		buildStrategy: merged.buildStrategy,
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

	return result;
}

function normalizeGlobalOption(value: unknown, sourceFile: string): LocaleMessages | Record<string, string> {
	const global = getObject(value);

	if (!global) {
		throw new Error(`${sourceFile}: vue-internationalization global option must be an object.`);
	}

	const result: LocaleMessages | Record<string, string> = {};

	for (const [locale, messages] of Object.entries(global)) {
		if (typeof messages === 'string') {
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

	return dictionary as LocaleDictionary;
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
		throw new Error('vue-internationalization options were used before Vite config was resolved.');
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

function generateRuntimeModule(primaryLocale: string, locales: string[]): string {
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
		'import { createInternationalization as __createInternationalization, setActiveInternationalization, useInternationalization, useLocale } from "vue-internationalization/runtime";',
		`export const primaryLocale = ${JSON.stringify(primaryLocale)};`,
		`export const locales = ${JSON.stringify(locales)};`,
		`export const localeLoaders = {\n  ${loaderEntries}\n};`,
		'export { setActiveInternationalization, useInternationalization, useLocale };',
		'export function createInternationalization(options = {}) {',
		'  return __createInternationalization({',
		'    primaryLocale,',
		'    initialLocale: options.initialLocale ?? primaryLocale,',
		'    loaders: localeLoaders,',
		'    fallbackLocale: options.fallbackLocale ?? primaryLocale',
		'  });',
		'}',
	].join('\n');
}

function generateInlineRuntimeModule(primaryLocale: string, locales: string[]): string {
	const loaderEntries = locales
		.map((locale) => `${JSON.stringify(locale)}: () => Promise.resolve({ global: {}, modules: {} })`)
		.join(',\n  ');

	return [
		'import { createInternationalization as __createInternationalization, setActiveInternationalization, useInternationalization, useLocale } from "vue-internationalization/runtime";',
		`export const primaryLocale = ${JSON.stringify(primaryLocale)};`,
		`export const locales = ${JSON.stringify(locales)};`,
		`export const localeLoaders = {\n  ${loaderEntries}\n};`,
		'export { setActiveInternationalization, useInternationalization, useLocale };',
		'function __getInlineLocale() {',
		'  if (typeof window === "undefined") return undefined;',
		'  const locale = new URL(window.location.href).searchParams.get("locale");',
		'  return locales.includes(locale) ? locale : undefined;',
		'}',
		'function __navigateInlineLocale(locale) {',
		'  if (typeof window === "undefined" || __getInlineLocale() === locale) return;',
		'  const url = new URL(window.location.href);',
		'  if (locale === primaryLocale) url.searchParams.delete("locale");',
		'  else url.searchParams.set("locale", locale);',
		'  window.location.assign(url);',
		'}',
		'export function createInternationalization(options = {}) {',
		'  return __createInternationalization({',
		'    primaryLocale,',
		'    initialLocale: __getInlineLocale() ?? options.initialLocale ?? primaryLocale,',
		'    loaders: localeLoaders,',
		'    fallbackLocale: options.fallbackLocale ?? primaryLocale,',
		'    onLocaleChange: __navigateInlineLocale',
		'  });',
		'}',
	].join('\n');
}

function generateLocaleModule(locale: string, modules: ModuleMessages, global: LocaleMessages): string {
	const localeModules: Record<string, LocaleDictionary> = {};

	for (const [moduleId, messages] of Object.entries(modules)) {
		if (messages?.[locale]) {
			localeModules[moduleId] = messages[locale];
		}
	}

	return [
		`export const locale = ${JSON.stringify(locale)};`,
		`export const global = ${JSON.stringify(global[locale] ?? {})};`,
		`export const modules = ${JSON.stringify(localeModules)};`,
		'export default { locale, global, modules };',
	].join('\n');
}

function toRuntimeModuleId(filename: string, root: string): string {
	const relativePath = relative(root, filename).replace(/\\/g, '/');
	return `/${relativePath}`;
}

function transformVueSfcInline(code: string, filename: string, root: string): string | undefined {
	const parsed = parseVueLocales(code, filename);

	if (parsed.blocks.length === 0) {
		return undefined;
	}

	const moduleId = toRuntimeModuleId(filename, root);
	return injectInlineLocaleBinding(rewriteInlineLocaleTemplateAccess(stripLocaleBlocks(code, filename), moduleId), moduleId);
}

function rewriteWrittenHtml(outDir: string, manifest: InlineChunkManifest): void {
	for (const file of findHtmlFiles(outDir)) {
		const html = readFileSync(file, 'utf8');
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
