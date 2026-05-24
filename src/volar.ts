import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolve } from 'node:path';
import { allCodeFeatures } from '@vue/language-core';
import {
	createComponentLocaleType,
	createComponentLocalizerType,
	createLocaleConstRefType,
	createLocaleConstScopeType,
	createLocalizerRefType,
	createLocalizerScopeType,
	createLocalizerDocumentationRefType,
	createLocalizerDocumentationScopeType,
} from './localeTypes.js';
import { getLocaleMessageLinkedKeys } from './message.js';
import {
	loadLocaleEnvDictionaryForDiagnostics,
	type LocaleEnvSources,
} from './localeEnv.js';
import {
	mergeLocaleDictionaries,
	parseLocaleDictionaryForDiagnostics,
	parseScriptLocaleDictionaries,
	type LocaleDictionaryDiagnostic,
} from './parse.js';
import type { VueLanguagePlugin } from '@vue/language-core';
import type { Code } from '@vue/language-core';
import type { LocaleMessageSyntax } from './message.js';
import type { LocaleDictionary } from './types.js';

export type VueInternationalizationVolarPluginConfig = {
	primaryLocale?: string;
	global?: LocaleEnvSources;
	localizerDocumentation?: boolean;
	messageSyntax?: LocaleMessageSyntax;
};

const plugin: VueLanguagePlugin<VueInternationalizationVolarPluginConfig> = ({ config }) => {
	const cache = createVolarCache();

	return {
		version: 2.2,
		name: 'vite-vue-internationalization',
		order: 1,
		resolveEmbeddedCode(fileName, ir, embeddedFile) {
			if (!/^script_(js|jsx|ts|tsx)$/.test(embeddedFile.id) || !hasLocaleSources(ir.content, ir.customBlocks)) {
				return;
			}

			const primaryLocale = config.primaryLocale ?? getFirstLocale(ir.customBlocks);
			const moduleDictionary = getLocaleDictionary(cache, ir.content, fileName, ir.customBlocks, primaryLocale);
			const globalDictionary = getGlobalDictionary(cache, config, primaryLocale, fileName);
			const generatedTypes = getGeneratedTypes(cache, config, globalDictionary, moduleDictionary);
			const { localeRefType, localeScopeType, localizerRefType, localizerScopeType, componentLocaleType, componentLocalizerType } = generatedTypes;
			const declaration = `declare const $locale: ${localeRefType};\ndeclare const $l: ${localizerRefType};\n`;
			const setupExposure = '$locale: typeof $locale;\n$l: typeof $l;\n';

			embeddedFile.content.unshift(declaration);
			pushLocaleDiagnostics(embeddedFile.content, getLocaleDiagnostics(cache, ir.customBlocks, primaryLocale, moduleDictionary));
			insertAfter(
				embeddedFile.content,
				'type __VLS_SetupExposed = import(\'vue\').ShallowUnwrapRef<{\n',
				setupExposure,
			);
			insertAfter(
				embeddedFile.content,
				'...{} as import(\'vue\').ComponentPublicInstance,\n',
				`...{} as { $locale: ${localeScopeType}; $l: ${localizerScopeType}; },\n`,
			);
			replaceFirst(
				embeddedFile.content,
				'const __VLS_ctx = {} as import(\'vue\').ComponentPublicInstance;',
				`const __VLS_ctx = {} as import('vue').ComponentPublicInstance & { $locale: ${localeScopeType}; $l: ${localizerScopeType}; };`,
			);
			replaceFirst(
				embeddedFile.content,
				'export default {} as typeof __VLS_export;',
				`export default {} as typeof __VLS_export & { $locale: ${componentLocaleType}; $l: ${componentLocalizerType}; };`,
			);
			applyTemplateTsDirectives(ir.content, embeddedFile.content);
		},
	};
};

export default plugin;

type GeneratedTypes = {
	localeRefType: string;
	localeScopeType: string;
	localizerRefType: string;
	localizerScopeType: string;
	componentLocaleType: string;
	componentLocalizerType: string;
};

type VolarCache = {
	globalDictionaries: Map<string, LocaleDictionary | undefined>;
	moduleDictionaries: Map<string, LocaleDictionary>;
	moduleDiagnostics: Map<string, LocaleBlockDiagnostic[]>;
	generatedTypes: Map<string, GeneratedTypes>;
};

type LocaleCustomBlock = {
	name: string;
	type: string;
	attrs: Record<string, string | true>;
	lang?: string;
	content: string;
};

type LocaleBlockDiagnostic = LocaleDictionaryDiagnostic & {
	source: string;
};

function createVolarCache(): VolarCache {
	return {
		globalDictionaries: new Map(),
		moduleDictionaries: new Map(),
		moduleDiagnostics: new Map(),
		generatedTypes: new Map(),
	};
}

function hasLocaleSources(content: string, customBlocks: readonly { type: string }[]): boolean {
	return customBlocks.some((block) => block.type === 'locale') || content.includes('defineInternationalization');
}

function insertAfter(content: Code[], marker: string, insertion: string): void {
	replaceFirst(content, marker, `${marker}${insertion}`);
}

function replaceFirst(content: Code[], search: string, replacement: string): void {
	const text = content.map((segment) => getSegmentText(segment) ?? '').join('');
	const start = text.indexOf(search);

	if (start < 0) {
		return;
	}

	replaceGeneratedRange(content, start, start + search.length, replacement);
}

function replaceGeneratedRange(content: Code[], start: number, end: number, replacement: string): void {
	const next: Code[] = [];
	let offset = 0;
	let inserted = false;

	for (let index = 0; index < content.length; index++) {
		const segment = content[index];
		const text = getSegmentText(segment);

		if (text === undefined) {
			next.push(segment);
			continue;
		}

		const segmentStart = offset;
		const segmentEnd = offset + text.length;

		if (segmentEnd <= start || segmentStart >= end) {
			next.push(segment);
		} else {
			const prefixEnd = Math.max(0, start - segmentStart);
			const suffixStart = Math.min(text.length, end - segmentStart);

			if (prefixEnd > 0) {
				next.push(sliceSegment(segment, 0, prefixEnd));
			}

			if (!inserted) {
				next.push(replacement);
				inserted = true;
			}

			if (suffixStart < text.length) {
				next.push(sliceSegment(segment, suffixStart, text.length));
			}
		}

		offset = segmentEnd;
	}

	content.splice(0, content.length, ...next);
}

function insertGeneratedText(content: Code[], start: number, insertion: string): void {
	const next: Code[] = [];
	let offset = 0;
	let inserted = false;

	for (let index = 0; index < content.length; index++) {
		const segment = content[index];
		const text = getSegmentText(segment);

		if (text === undefined) {
			next.push(segment);
			continue;
		}

		const segmentStart = offset;
		const segmentEnd = offset + text.length;

		if (!inserted && start >= segmentStart && start <= segmentEnd) {
			const prefixEnd = start - segmentStart;

			if (prefixEnd > 0) {
				next.push(sliceSegment(segment, 0, prefixEnd));
			}

			next.push(insertion);
			inserted = true;

			if (prefixEnd < text.length) {
				next.push(sliceSegment(segment, prefixEnd, text.length));
			}
		} else {
			next.push(segment);
		}

		offset = segmentEnd;
	}

	if (!inserted) {
		next.push(insertion);
	}

	content.splice(0, content.length, ...next);
}

function applyTemplateTsDirectives(source: string, content: Code[]): void {
	const directives = findTemplateTsDirectives(source, getTemplateContentStart(source));

	if (directives.length === 0) {
		return;
	}

	const insertions = new Map<number, string>();
	const consumedDirectiveIndexes = new Set<number>();
	const contentText = getContentText(content);
	let generatedOffset = 0;

	for (const segment of content) {
		const text = getSegmentText(segment);

		if (text === undefined) {
			continue;
		}

		if (typeof segment !== 'string' && typeof segment[2] === 'number') {
			const lineStart = getLineStart(contentText, generatedOffset);
			const lineEnd = contentText.indexOf('\n', generatedOffset);
			const generatedLine = contentText.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
			const directiveIndex = directives.findIndex((directive, index) =>
				!consumedDirectiveIndexes.has(index) &&
				directive.ends.some((end) => segment[2] > end) &&
				generatedLine.includes('__VLS_ctx.'),
			);

			if (directiveIndex >= 0) {
				insertions.set(lineStart, `${directives[directiveIndex]?.text}\n`);
				consumedDirectiveIndexes.add(directiveIndex);
			}
		}

		generatedOffset += text.length;
	}

	for (const [offset, text] of [...insertions].sort((a, b) => b[0] - a[0])) {
		insertGeneratedText(content, offset, text);
	}
}

function findTemplateTsDirectives(source: string, templateContentStart: number | undefined): Array<{ ends: number[]; text: string }> {
	return [...source.matchAll(/<!--\s*@(ts-expect-error|ts-ignore)([^>]*)-->/g)]
		.map((match) => ({
			ends: getDirectiveEnds(match.index + match[0].length, templateContentStart),
			text: `// @${match[1]}${normalizeDirectiveSuffix(match[2])}`,
		}));
}

function getDirectiveEnds(end: number, templateContentStart: number | undefined): number[] {
	return templateContentStart === undefined || end < templateContentStart
		? [end]
		: [end, end - templateContentStart];
}

function getTemplateContentStart(source: string): number | undefined {
	const templateOpen = source.match(/<template\b[^>]*>/);

	if (templateOpen?.index == null) {
		return undefined;
	}

	return templateOpen.index + templateOpen[0].length;
}

function normalizeDirectiveSuffix(value: string): string {
	const suffix = value.trim();
	if (suffix.length === 0) {
		return '';
	}

	return suffix.startsWith(':') ? suffix : ` ${suffix}`;
}

function getContentText(content: Code[]): string {
	return content.map((segment) => getSegmentText(segment) ?? '').join('');
}

function getLineStart(text: string, offset: number): number {
	return text.lastIndexOf('\n', offset - 1) + 1;
}

function getSegmentText(segment: Code): string | undefined {
	if (typeof segment === 'string') {
		return segment;
	}

	return typeof segment[0] === 'string' ? segment[0] : undefined;
}

function sliceSegment(segment: Code, start: number, end: number): Code {
	if (typeof segment === 'string') {
		return segment.slice(start, end);
	}

	const next = [...segment] as Code & unknown[];
	next[0] = segment[0].slice(start, end);

	if (typeof next[2] === 'number') {
		next[2] += start;
	}

	return next as Code;
}

function getFirstLocale(customBlocks: readonly { type: string; attrs: Record<string, string | true> }[]): string | undefined {
	for (const block of customBlocks) {
		if (block.type === 'locale' && typeof block.attrs.locale === 'string') {
			return block.attrs.locale;
		}
	}
}

function getGeneratedTypes(
	cache: VolarCache,
	config: VueInternationalizationVolarPluginConfig,
	globalDictionary: LocaleDictionary | undefined,
	moduleDictionary: LocaleDictionary,
): GeneratedTypes {
	const key = [
		config.localizerDocumentation === false ? 'compact' : 'documented',
		config.messageSyntax ?? 'vue',
		stableStringify(globalDictionary ?? {}),
		stableStringify(moduleDictionary),
	].join('\n');
	const cached = cache.generatedTypes.get(key);

	if (cached) {
		return cached;
	}

	const types = {
		localeRefType: createLocaleConstRefType({
			global: globalDictionary,
			module: moduleDictionary,
			messageSyntax: config.messageSyntax ?? 'vue',
		}),
		localeScopeType: createLocaleConstScopeType({
			global: globalDictionary,
			module: moduleDictionary,
			messageSyntax: config.messageSyntax ?? 'vue',
		}),
		localizerRefType: config.localizerDocumentation === false
			? createLocalizerRefType({
				global: globalDictionary,
				module: moduleDictionary,
				messageSyntax: config.messageSyntax ?? 'vue',
			})
			: createLocalizerDocumentationRefType({
				global: globalDictionary,
				module: moduleDictionary,
				messageSyntax: config.messageSyntax ?? 'vue',
			}),
		localizerScopeType: config.localizerDocumentation === false
			? createLocalizerScopeType({
				global: globalDictionary,
				module: moduleDictionary,
			})
			: createLocalizerDocumentationScopeType({
				global: globalDictionary,
				module: moduleDictionary,
			}),
		componentLocaleType: createComponentLocaleType({
			module: moduleDictionary,
		}),
		componentLocalizerType: createComponentLocalizerType({
			module: moduleDictionary,
			messageSyntax: config.messageSyntax ?? 'vue',
		}),
	};

	cache.generatedTypes.set(key, types);
	return types;
}

function getLocaleDictionary(
	cache: VolarCache,
	content: string,
	fileName: string,
	customBlocks: readonly LocaleCustomBlock[],
	primaryLocale: string | undefined,
): LocaleDictionary {
	const localeBlocks = customBlocks.filter((block) => block.type === 'locale' && typeof block.attrs.locale === 'string');
	const scriptMessages = parseScriptLocaleDictionaries(content, fileName);

	if (localeBlocks.length === 0 && Object.keys(scriptMessages).length === 0) {
		return {};
	}

	const primaryBlock = localeBlocks.find((item) => item.attrs.locale === primaryLocale);
	const primaryBlockLocale = primaryBlock ? String(primaryBlock.attrs.locale) : undefined;
	const blockLocale = localeBlocks.length > 0 ? String(localeBlocks[0].attrs.locale) : undefined;
	const scriptLocale = primaryLocale && scriptMessages[primaryLocale] ? primaryLocale : String(Object.keys(scriptMessages)[0]);
	const locale = primaryBlockLocale ?? blockLocale ?? scriptLocale;
	const blocks = localeBlocks.filter((item) => item.attrs.locale === locale);
	const key = [
		String(primaryLocale ?? ''),
		locale,
		content,
		...blocks.map((block) => [
			block.lang ?? 'yaml',
			block.content,
		].join('\n')),
	].join('\n');
	const cached = cache.moduleDictionaries.get(key);

	if (cached) {
		return cached;
	}

	const dictionary = mergeLocaleDictionaries(
		...blocks.map((block) =>
			parseLocaleDictionaryForDiagnostics(
				block.content,
				block.lang ?? 'yaml',
				`<locale locale="${locale}">`,
			).dictionary),
		scriptMessages[locale] ?? {},
	);
	cache.moduleDictionaries.set(key, dictionary);
	return dictionary;
}

function getLocaleDiagnostics(
	cache: VolarCache,
	customBlocks: readonly LocaleCustomBlock[],
	primaryLocale: string | undefined,
	moduleDictionary: LocaleDictionary,
): LocaleBlockDiagnostic[] {
	const localeBlocks = customBlocks.filter((block) => block.type === 'locale' && typeof block.attrs.locale === 'string');
	const key = localeBlocks
		.map((block) => [
			String(primaryLocale ?? ''),
			block.name,
			String(block.attrs.locale),
			block.lang ?? 'yaml',
			block.content,
		].join('\n'))
		.join('\n---\n');
	const cached = cache.moduleDiagnostics.get(key);

	if (cached) {
		return cached;
	}

	const diagnostics = localeBlocks.flatMap((block) => {
		const result = parseLocaleDictionaryForDiagnostics(
			block.content,
			block.lang ?? 'yaml',
			`<locale locale="${String(block.attrs.locale)}">`,
		);

		return result.diagnostics.map((diagnostic) => ({
			...diagnostic,
			source: block.name,
		}));
	});
	const linkedDiagnostics = getLinkedMessageDiagnostics(localeBlocks, primaryLocale, moduleDictionary);

	const allDiagnostics = [...diagnostics, ...linkedDiagnostics];
	cache.moduleDiagnostics.set(key, allDiagnostics);
	return allDiagnostics;
}

function getLinkedMessageDiagnostics(
	localeBlocks: readonly LocaleCustomBlock[],
	primaryLocale: string | undefined,
	moduleDictionary: LocaleDictionary,
): LocaleBlockDiagnostic[] {
	if (!primaryLocale) {
		return [];
	}

	return localeBlocks
		.filter((block) => block.attrs.locale === primaryLocale)
		.flatMap((block) => {
			const result = parseLocaleDictionaryForDiagnostics(
				block.content,
				block.lang ?? 'yaml',
				`<locale locale="${primaryLocale}">`,
			);

			return getDictionaryLinkedMessageDiagnostics(result.dictionary, moduleDictionary)
				.map((message) => ({
					message,
					start: 0,
					end: Math.max(1, block.content.length),
					source: block.name,
				}));
		});
}

function getDictionaryLinkedMessageDiagnostics(
	dictionary: LocaleDictionary,
	rootDictionary: LocaleDictionary,
	path: string[] = [],
): string[] {
	const diagnostics: string[] = [];

	for (const [key, value] of Object.entries(dictionary)) {
		const nextPath = [...path, key];

		if (typeof value === 'string') {
			for (const linkedKey of getLocaleMessageLinkedKeys(value)) {
				const linkedPath = resolveSfcLinkedPath(linkedKey);

				if (linkedPath && typeof getValueByPath(rootDictionary, linkedPath) !== 'string') {
					diagnostics.push(`Linked message "@:${linkedKey}" in "${nextPath.join('.')}" does not resolve in the SFC locale dictionary.`);
				}
			}
			continue;
		}

		if (isLocaleDictionary(value)) {
			diagnostics.push(...getDictionaryLinkedMessageDiagnostics(value, rootDictionary, nextPath));
		}
	}

	return diagnostics;
}

function resolveSfcLinkedPath(key: string): string[] | undefined {
	const [scope, ...keys] = key.split('.');

	if (scope === 'env') {
		return undefined;
	}

	if (scope === 'sfc') {
		return keys.length > 0 ? keys : undefined;
	}

	return key.split('.');
}

function getValueByPath(dictionary: LocaleDictionary, path: string[]): unknown {
	return path.reduce<unknown>((current, key) => {
		if (!isLocaleDictionary(current)) {
			return undefined;
		}

		return current[key];
	}, dictionary);
}

function isLocaleDictionary(value: unknown): value is LocaleDictionary {
	return value != null && typeof value === 'object' && !Array.isArray(value);
}

function pushLocaleDiagnostics(content: Code[], diagnostics: LocaleBlockDiagnostic[]): void {
	if (diagnostics.length > 0) {
		content.unshift('declare function __VUE_INTERNATIONALIZATION_LOCALE_DIAGNOSTIC__(message: never): void;\n');
	}

	diagnostics.forEach((diagnostic, index) => {
		const name = `__VUE_INTERNATIONALIZATION_LOCALE_DIAGNOSTIC_${index}`;

		content.unshift(
			'__VUE_INTERNATIONALIZATION_LOCALE_DIAGNOSTIC__(',
			[
				JSON.stringify(diagnostic.message),
				diagnostic.source,
				diagnostic.start,
				allCodeFeatures,
			],
			');\n',
			'// ',
			[
				name,
				diagnostic.source,
				diagnostic.start,
				allCodeFeatures,
			],
			'\n',
		);
	});
}

function getGlobalDictionary(
	cache: VolarCache,
	config: VueInternationalizationVolarPluginConfig,
	primaryLocale: string | undefined,
	fileName: string,
): LocaleDictionary | undefined {
	const global = config.global;

	if (!global || !primaryLocale) {
		return undefined;
	}

	const value = global[primaryLocale];

	if (!value) {
		return undefined;
	}

	if (typeof value !== 'string' && !Array.isArray(value)) {
		const key = `object:${primaryLocale}:${stableStringify(value)}`;
		const cached = cache.globalDictionaries.get(key);

		if (cached) {
			return cached;
		}

		const result = parseLocaleDictionaryForDiagnostics(
			JSON.stringify(value),
			'json',
			`global.${primaryLocale}`,
		);
		cache.globalDictionaries.set(key, result.dictionary);
		return result.dictionary;
	}

	const configDir = findConfigDir(fileName);
	return loadLocaleEnvDictionaryForDiagnostics(configDir, primaryLocale, value);
}

function findConfigDir(fileName: string): string {
	let dir = dirname(fileName);

	while (dir !== dirname(dir)) {
		if (existsSync(resolve(dir, 'tsconfig.json'))) {
			return dir;
		}

		dir = dirname(dir);
	}

	return process.cwd();
}

function stableStringify(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(',')}]`;
	}

	if (value != null && typeof value === 'object') {
		return `{${Object.entries(value)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
			.join(',')}}`;
	}

	return JSON.stringify(value);
}
