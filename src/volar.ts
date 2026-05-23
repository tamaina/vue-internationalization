import { isAbsolute, resolve } from 'node:path';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import {
	createLocaleConstRefType,
	createLocaleConstScopeType,
	createLocalizerDocumentationRefType,
	createLocalizerDocumentationScopeType,
} from './localeTypes.js';
import { parseLocaleDictionary } from './parse.js';
import type { VueLanguagePlugin } from '@vue/language-core';
import type { Code } from '@vue/language-core';
import type { LocaleDictionary } from './types.js';

type LocaleEnvSource = LocaleDictionary | string | string[];
type LocaleEnvSources = Partial<Record<string, LocaleEnvSource>>;

export type VueInternationalizationVolarPluginConfig = {
	primaryLocale?: string;
	global?: LocaleEnvSources;
};

const plugin: VueLanguagePlugin<VueInternationalizationVolarPluginConfig> = ({ config }) => {
	return {
		version: 2.2,
		name: 'vue-internationalization',
		order: 1,
		resolveEmbeddedCode(fileName, ir, embeddedFile) {
			if (!/^script_(js|jsx|ts|tsx)$/.test(embeddedFile.id) || !hasLocaleBlocks(ir.customBlocks)) {
				return;
			}

			const primaryLocale = config.primaryLocale ?? getFirstLocale(ir.customBlocks);
			const moduleDictionary = getLocaleDictionary(ir.customBlocks, primaryLocale);
			const globalDictionary = getGlobalDictionary(config, primaryLocale, fileName);
			const localeRefType = createLocaleConstRefType({
				global: globalDictionary,
				module: moduleDictionary,
			});
			const localeScopeType = createLocaleConstScopeType({
				global: globalDictionary,
				module: moduleDictionary,
			});
			const localizerRefType = createLocalizerDocumentationRefType({
				global: globalDictionary,
				module: moduleDictionary,
			});
			const localizerScopeType = createLocalizerDocumentationScopeType({
				global: globalDictionary,
				module: moduleDictionary,
			});
			const declaration = `declare const $locale: ${localeRefType};\ndeclare const $l: ${localizerRefType};\n`;
			const setupExposure = '$locale: typeof $locale;\n$l: typeof $l;\n';

			embeddedFile.content.unshift(declaration);
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
		},
	};
};

export default plugin;

function hasLocaleBlocks(customBlocks: readonly { type: string }[]): boolean {
	return customBlocks.some((block) => block.type === 'locale');
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

function getLocaleDictionary(
	customBlocks: readonly { type: string; attrs: Record<string, string | true>; lang?: string; content: string }[],
	primaryLocale: string | undefined,
): LocaleDictionary {
	const localeBlocks = customBlocks.filter((block) => block.type === 'locale' && typeof block.attrs.locale === 'string');

	if (localeBlocks.length === 0) {
		return {};
	}

	const block = localeBlocks.find((item) => item.attrs.locale === primaryLocale) ?? localeBlocks[0];

	return parseLocaleDictionary(block.content, block.lang ?? 'yaml', `<locale locale="${String(block.attrs.locale)}">`);
}

function getGlobalDictionary(
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
		return value;
	}

	return loadLocaleEnvDictionary(findConfigDir(fileName), primaryLocale, value);
}

function loadLocaleEnvDictionary(root: string, locale: string, source: string | string[]): LocaleDictionary {
	const files = expandLocaleEnvSources(root, source);
	const merged: LocaleDictionary = {};

	for (const file of files) {
		const lang = file.endsWith('.json') ? 'json' : 'yaml';
		const dictionary = parseLocaleDictionary(readFileSync(file, 'utf8'), lang, file);
		mergeLocaleEnvDictionary(merged, dictionary, [], `${locale}:${file}`);
	}

	return merged;
}

function mergeLocaleEnvDictionary(
	target: LocaleDictionary,
	source: LocaleDictionary,
	path: string[],
	sourceLabel: string,
): void {
	for (const [key, value] of Object.entries(source)) {
		const currentPath = [...path, key];
		const current = target[key];

		if (isPlainDictionary(current) && isPlainDictionary(value)) {
			mergeLocaleEnvDictionary(current, value, currentPath, sourceLabel);
			continue;
		}

		if (Object.prototype.hasOwnProperty.call(target, key)) {
			console.warn(`[vue-internationalization] Duplicate env key "${currentPath.join('.')}" in ${sourceLabel}; overwriting previous value.`);
		}

		target[key] = value;
	}
}

function expandLocaleEnvSources(root: string, source: string | string[]): string[] {
	const sources = Array.isArray(source) ? source : [source];
	const files = new Set<string>();

	for (const entry of sources) {
		for (const file of expandLocaleEnvSource(root, entry)) {
			files.add(file);
		}
	}

	return [...files].sort();
}

function expandLocaleEnvSource(root: string, source: string): string[] {
	const pattern = normalizePath(isAbsolute(source) ? source : resolve(root, source));

	if (!hasGlob(pattern)) {
		return [pattern];
	}

	const base = getGlobBase(pattern);
	const files = findFiles(base)
		.map((file) => normalizePath(file))
		.filter((file) => matchGlob(pattern, file));

	return files.sort();
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

function isPlainDictionary(value: unknown): value is LocaleDictionary {
	return value != null && typeof value === 'object' && !Array.isArray(value);
}

function hasGlob(value: string): boolean {
	return /[*?]/u.test(value);
}

function normalizePath(value: string): string {
	return value.replace(/\\/g, '/');
}

function getGlobBase(pattern: string): string {
	const segments = pattern.split('/');
	const globIndex = segments.findIndex((segment) => hasGlob(segment));
	const baseSegments = globIndex < 0 ? segments : segments.slice(0, globIndex);
	const base = baseSegments.join('/');

	return base.length === 0 ? '/' : base;
}

function findFiles(dir: string): string[] {
	if (!existsSync(dir)) {
		return [];
	}

	const stat = statSync(dir);

	if (stat.isFile()) {
		return [dir];
	}

	if (!stat.isDirectory()) {
		return [];
	}

	const files: string[] = [];

	for (const entry of readdirSync(dir)) {
		const file = resolve(dir, entry);
		const entryStat = statSync(file);

		if (entryStat.isDirectory()) {
			files.push(...findFiles(file));
			continue;
		}

		if (entryStat.isFile()) {
			files.push(file);
		}
	}

	return files;
}

function matchGlob(pattern: string, file: string): boolean {
	return matchGlobSegments(pattern.split('/'), file.split('/'));
}

function matchGlobSegments(pattern: string[], file: string[]): boolean {
	if (pattern.length === 0) {
		return file.length === 0;
	}

	const [current, ...rest] = pattern;

	if (current === '**') {
		return matchGlobSegments(rest, file) || (file.length > 0 && matchGlobSegments(pattern, file.slice(1)));
	}

	if (file.length === 0) {
		return false;
	}

	return matchGlobSegment(current, file[0] as string) && matchGlobSegments(rest, file.slice(1));
}

function matchGlobSegment(pattern: string, value: string): boolean {
	let regexp = '^';

	for (const char of pattern) {
		if (char === '*') {
			regexp += '[^/]*';
			continue;
		}

		if (char === '?') {
			regexp += '[^/]';
			continue;
		}

		regexp += escapeRegExp(char);
	}

	return new RegExp(`${regexp}$`, 'u').test(value);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
