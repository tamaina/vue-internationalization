import { isAbsolute, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { createLocaleRefType, createLocaleScopeType, createLocalizerRefType, createLocalizerScopeType } from './localeTypes.js';
import { parseLocaleDictionary } from './parse.js';
import type { VueLanguagePlugin } from '@vue/language-core';
import type { Code } from '@vue/language-core';
import type { LocaleDictionary } from './types.js';

type LocaleMessages = Partial<Record<string, LocaleDictionary>>;

export type VueInternationalizationVolarPluginConfig = {
	primaryLocale?: string;
	global?: LocaleMessages | Record<string, string>;
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
			const localeRefType = createLocaleRefType({
				global: globalDictionary,
				module: moduleDictionary,
			});
			const localeScopeType = createLocaleScopeType({
				global: globalDictionary,
				module: moduleDictionary,
			});
			const localizerRefType = createLocalizerRefType({
				global: globalDictionary,
				module: moduleDictionary,
			});
			const localizerScopeType = createLocalizerScopeType({
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

	if (typeof value !== 'string') {
		return value;
	}

	const file = isAbsolute(value) ? value : resolve(findConfigDir(fileName), value);
	const lang = file.endsWith('.json') ? 'json' : 'yaml';
	return parseLocaleDictionary(readFileSync(file, 'utf8'), lang, file);
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
