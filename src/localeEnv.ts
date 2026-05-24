import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { parseLocaleDictionary, parseLocaleDictionaryForDiagnostics, type LocaleDictionaryDiagnostic } from './parse.js';
import type { LocaleDictionary } from './types.js';

export type LocaleEnvSource = LocaleDictionary | string | string[];
export type LocaleEnvSources = Partial<Record<string, LocaleEnvSource>>;
export type LocaleEnvDictionaryDiagnosticsResult = {
	dictionary: LocaleDictionary;
	diagnostics: LocaleDictionaryDiagnostic[];
};

export function loadLocaleEnvDictionary(root: string, locale: string, source: string | string[]): LocaleDictionary {
	const files = expandLocaleEnvSources(root, source);
	const merged: LocaleDictionary = {};

	for (const file of files) {
		const lang = file.endsWith('.json') ? 'json' : 'yaml';
		const dictionary = parseLocaleDictionary(readFileSync(file, 'utf8'), lang, file);
		mergeLocaleEnvDictionary(merged, dictionary, [], `${locale}:${file}`);
	}

	return merged;
}

export function loadLocaleEnvDictionaryForDiagnostics(root: string, locale: string, source: string | string[]): LocaleDictionary {
	return loadLocaleEnvDictionaryWithDiagnostics(root, locale, source).dictionary;
}

export function loadLocaleEnvDictionaryWithDiagnostics(
	root: string,
	locale: string,
	source: string | string[],
): LocaleEnvDictionaryDiagnosticsResult {
	let files: string[];

	try {
		files = expandLocaleEnvSources(root, source);
	} catch (error) {
		return {
			dictionary: {},
			diagnostics: [{
				message: error instanceof Error ? error.message : String(error),
				start: 0,
				end: 1,
			}],
		};
	}

	const merged: LocaleDictionary = {};
	const diagnostics: LocaleDictionaryDiagnostic[] = [];

	for (const file of files) {
		const lang = file.endsWith('.json') ? 'json' : 'yaml';
		let content: string;

		try {
			content = readFileSync(file, 'utf8');
		} catch (error) {
			diagnostics.push({
				message: `Failed to read ${file}: ${error instanceof Error ? error.message : String(error)}`,
				start: 0,
				end: 1,
			});
			continue;
		}

		const result = parseLocaleDictionaryForDiagnostics(content, lang, file);
		const dictionary = result.dictionary;

		diagnostics.push(...result.diagnostics);
		mergeLocaleEnvDictionaryForDiagnostics(merged, dictionary);
	}

	return {
		dictionary: merged,
		diagnostics,
	};
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

		if (isUnsafeDictionaryKey(key)) {
			throw new Error(`${sourceLabel} contains unsafe locale key "${currentPath.join('.')}".`);
		}

		if (isPlainDictionary(current) && isPlainDictionary(value)) {
			mergeLocaleEnvDictionary(current, value, currentPath, sourceLabel);
			continue;
		}

		if (Object.prototype.hasOwnProperty.call(target, key)) {
			console.warn(`[vite-vue-internationalization] Duplicate env key "${currentPath.join('.')}" in ${sourceLabel}; overwriting previous value.`);
		}

		target[key] = value;
	}
}

function mergeLocaleEnvDictionaryForDiagnostics(target: LocaleDictionary, source: LocaleDictionary): void {
	for (const [key, value] of Object.entries(source)) {
		const current = target[key];

		if (isPlainDictionary(current) && isPlainDictionary(value)) {
			mergeLocaleEnvDictionaryForDiagnostics(current, value);
			continue;
		}

		target[key] = value;
	}
}

export function expandLocaleEnvSources(root: string, source: string | string[]): string[] {
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

function isPlainDictionary(value: unknown): value is LocaleDictionary {
	return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isUnsafeDictionaryKey(key: string): boolean {
	return key === '__proto__' || key === 'prototype' || key === 'constructor';
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
