import { parse as parseSfc } from '@vue/compiler-sfc';
import ts from 'typescript';
import YAML from 'yaml';
import { createComponentLocaleType, createComponentLocalizerType, createLocalizerRefType, createUseLocaleTypeParameters, type LocaleBindingTypes } from './localeTypes.js';
import { getScriptOpenTag, getScriptSetupOpenTag, injectScriptSetup } from './scriptSetup.js';
import type { LocaleDictionary, LocaleMessageFunction, ParsedVueLocale, SfcLocaleBlock } from './types.js';
import type { YAMLError } from 'yaml';

export type LocaleDictionaryDiagnostic = {
	message: string;
	start: number;
	end: number;
};

export type LocaleDictionaryParseResult = {
	dictionary: LocaleDictionary;
	diagnostics: LocaleDictionaryDiagnostic[];
};

export function parseVueLocales(code: string, filename: string): ParsedVueLocale {
	const result = parseSfc(code, { filename, pad: false });
	const blocks = result.descriptor.customBlocks
		.filter((block) => block.type === 'locale')
		.map((block) => {
			const locale = block.attrs.locale;

			if (typeof locale !== 'string' || locale.length === 0) {
				throw new Error(`<locale> block in ${filename} requires a locale attribute.`);
			}

			const lang = typeof block.attrs.lang === 'string' ? block.attrs.lang : 'yaml';

			const range = findCustomBlockRange(code, block.loc.start.offset, block.loc.end.offset, filename);

			return {
				locale,
				lang,
				content: block.content,
				start: range.start,
				end: range.end,
			};
		});

	return {
		code,
		moduleId: normalizeModuleId(filename),
		blocks,
		scriptMessages: parseScriptLocaleDictionaries(code, filename),
	};
}

export function parseLocaleDictionary(content: string, lang: string, sourceLabel: string): LocaleDictionary {
	const normalized = lang.toLowerCase();

	try {
		if (normalized === 'json') {
			return validateLocaleDictionary(JSON.parse(content), sourceLabel);
		}

		if (normalized === 'yaml' || normalized === 'yml') {
			return validateLocaleDictionary(YAML.parse(content) ?? {}, sourceLabel);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to parse ${sourceLabel}: ${message}`);
	}

	throw new Error(`Unsupported locale lang "${lang}" in ${sourceLabel}. Use yaml, yml, or json.`);
}

export function parseScriptLocaleDictionaries(code: string, filename: string): Partial<Record<string, LocaleDictionary>> {
	const result = parseSfc(code, { filename, pad: false });
	const messages: Partial<Record<string, LocaleDictionary>> = {};

	for (const script of [result.descriptor.script, result.descriptor.scriptSetup]) {
		if (!script) {
			continue;
		}

		const sourceFile = ts.createSourceFile(filename, script.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
		visitScriptNode(sourceFile, script.content, `<script>${filename}`, messages);
	}

	return messages;
}

export function parseLocaleDictionaryForDiagnostics(
	content: string,
	lang: string,
	sourceLabel: string,
): LocaleDictionaryParseResult {
	const normalized = lang.toLowerCase();

	if (normalized === 'json') {
		try {
			return validateLocaleDictionaryForDiagnostics(JSON.parse(content), sourceLabel);
		} catch (error) {
			return createDiagnosticResult(`Failed to parse ${sourceLabel}: ${getErrorMessage(error)}`, 0, Math.max(1, content.length));
		}
	}

	if (normalized === 'yaml' || normalized === 'yml') {
		const document = YAML.parseDocument(content);
		if (document.errors.length > 0) {
			const error = document.errors[0] as YAMLError;
			return createDiagnosticResult(`Failed to parse ${sourceLabel}: ${error.message}`, ...getYamlErrorRange(error, content));
		}

		try {
			return validateLocaleDictionaryForDiagnostics(document.toJSON() ?? {}, sourceLabel);
		} catch (error) {
			return createDiagnosticResult(`Failed to parse ${sourceLabel}: ${getErrorMessage(error)}`, 0, Math.max(1, content.length));
		}
	}

	return createDiagnosticResult(
		`Unsupported locale lang "${lang}" in ${sourceLabel}. Use yaml, yml, or json.`,
		0,
		Math.max(1, content.length),
	);
}

export function validateLocaleDictionary(value: unknown, sourceLabel: string): LocaleDictionary {
	assertSafeDictionary(value, sourceLabel, []);
	return value as LocaleDictionary;
}

function validateLocaleDictionaryForDiagnostics(value: unknown, sourceLabel: string): LocaleDictionaryParseResult {
	validateLocaleDictionary(value, sourceLabel);

	return {
		dictionary: value as LocaleDictionary,
		diagnostics: [],
	};
}

function createDiagnosticResult(message: string, start: number, end: number): LocaleDictionaryParseResult {
	return {
		dictionary: {},
		diagnostics: [{
			message,
			start,
			end,
		}],
	};
}

function getYamlErrorRange(error: YAMLError, content: string): [number, number] {
	const start = Math.max(0, Math.min(error.pos[0], content.length));
	const end = Math.max(start + 1, Math.min(error.pos[1], content.length));

	return [start, end];
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function mergeLocaleDictionaries(...dictionaries: LocaleDictionary[]): LocaleDictionary {
	const merged: LocaleDictionary = {};

	for (const dictionary of dictionaries) {
		mergeLocaleDictionaryInto(merged, dictionary);
	}

	return merged;
}

export function stripLocaleBlocks(code: string, filename: string): string {
	const { blocks } = parseVueLocales(code, filename);

	if (blocks.length === 0) {
		return code;
	}

	let next = '';
	let cursor = 0;

	for (const block of blocks) {
		next += code.slice(cursor, block.start);
		cursor = block.end;
	}

	next += code.slice(cursor);
	return next;
}

export function injectLocaleBinding(code: string, types: LocaleBindingTypes = {}): string {
	const setupOpenTag = getScriptSetupOpenTag(code);
	const scriptOpenTag = getScriptOpenTag(code);
	const shouldInjectTypes = setupOpenTag
		? isTypeScriptScript(setupOpenTag)
		: !scriptOpenTag || isTypeScriptScript(scriptOpenTag);
	const typeParameters = shouldInjectTypes ? createUseLocaleTypeParameters(types) : '';
	const localizerType = shouldInjectTypes ? ` as ${createLocalizerRefType(types)}` : '';
	const injection = [
		'',
		'import { useLocale as __useLocale, useLocalizer as __useLocalizer } from "virtual:vite-vue-internationalization";',
		`const $locale = __useLocale${typeParameters}(import.meta.url);`,
		`const $l = __useLocalizer(import.meta.url)${localizerType};`,
		'',
	].join('\n');

	return injectScriptSetup(code, injection);
}

export function transformVueSfc(code: string, filename: string, types: LocaleBindingTypes = {}): string | undefined {
	const parsed = parseVueLocales(code, filename);

	if (parsed.blocks.length === 0 && Object.keys(parsed.scriptMessages).length === 0) {
		return undefined;
	}

	const bindingTypes = {
		...types,
		module: getPrimaryLocaleDictionary(parsed.blocks, types.primaryLocale, parsed.scriptMessages),
	};

	return injectComponentLocaleOptions(injectLocaleBinding(stripLocaleBlocks(code, filename), bindingTypes), filename, bindingTypes);
}

export function normalizeModuleId(id: string): string {
	const withoutQuery = id.split('?', 1)[0] ?? id;
	return withoutQuery.replace(/\\/g, '/');
}

function assertSafeDictionary(value: unknown, sourceLabel: string, path: string[]): void {
	if (value == null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${sourceLabel} must contain an object at the top level.`);
	}

	for (const [key, child] of Object.entries(value)) {
		const currentPath = [...path, key];

		if (isUnsafeDictionaryKey(key)) {
			throw new Error(`${sourceLabel} contains unsafe locale key "${currentPath.join('.')}".`);
		}

		if (Array.isArray(child)) {
			assertSafeLocaleArray(child, sourceLabel, currentPath);
			continue;
		}

		if (child != null && typeof child === 'object') {
			assertSafeDictionary(child, sourceLabel, currentPath);
		}
	}
}

function assertSafeLocaleArray(value: unknown[], sourceLabel: string, path: string[]): void {
	value.forEach((item, index) => {
		const currentPath = [...path, String(index)];

		if (Array.isArray(item)) {
			assertSafeLocaleArray(item, sourceLabel, currentPath);
			return;
		}

		if (item != null && typeof item === 'object') {
			assertSafeDictionary(item, sourceLabel, currentPath);
		}
	});
}

function isUnsafeDictionaryKey(key: string): boolean {
	return key === '__proto__' || key === 'prototype' || key === 'constructor';
}

export function injectComponentLocaleOptions(
	code: string,
	filename: string,
	types: LocaleBindingTypes,
	options: {
		importLine?: string;
		localeExpression?: string;
		localizerExpression?: string;
	} = {},
): string {
	const result = parseSfc(code, { filename, pad: false });
	const localeType = createComponentLocaleType(types);
	const localizerType = createComponentLocalizerType(types);
	const scriptOpenTag = result.descriptor.script ? getScriptOpenTag(result.descriptor.script.loc.source) ?? getScriptOpenTag(code) : undefined;
	const setupOpenTag = result.descriptor.scriptSetup ? getScriptSetupOpenTag(result.descriptor.scriptSetup.loc.source) ?? getScriptSetupOpenTag(code) : undefined;
	const shouldInjectTypes = scriptOpenTag
		? isTypeScriptScript(scriptOpenTag)
		: !setupOpenTag || isTypeScriptScript(setupOpenTag);
	const scriptLangAttribute = scriptOpenTag ? '' : getScriptLangAttribute(setupOpenTag) ?? (shouldInjectTypes ? ' lang="ts"' : '');
	const importLine = options.importLine ?? 'import { createComponentLocale as __createComponentLocale, createComponentLocalizer as __createComponentLocalizer } from "virtual:vite-vue-internationalization";';
	const localeExpression = options.localeExpression ?? (shouldInjectTypes ? `__createComponentLocale<${localeType}>(import.meta.url)` : '__createComponentLocale(import.meta.url)');
	const localizerExpression = options.localizerExpression ?? (shouldInjectTypes ? `__createComponentLocalizer(import.meta.url) as ${localizerType}` : '__createComponentLocalizer(import.meta.url)');
	const importSection = importLine.length > 0 ? `${importLine}\n\n` : '';
	const optionLines = [
		`$locale: ${localeExpression},`,
		`$l: ${localizerExpression},`,
	];

	if (!result.descriptor.script) {
		return `${code}\n<script${scriptLangAttribute}>\n${importSection}export default {\n${optionLines.map((line) => `\t${line}`).join('\n')}\n};\n</script>\n`;
	}

	const script = result.descriptor.script;
	const content = script.content;
	const sourceFile = ts.createSourceFile(filename, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
	const exportAssignment = sourceFile.statements.find(ts.isExportAssignment);
	const insertAt = script.loc.start.offset;

	if (!exportAssignment || exportAssignment.isExportEquals) {
		const appended = [
			content,
			'',
			importSection.trimEnd(),
			'',
			'export default {',
			...optionLines.map((line) => `\t${line}`),
			'};',
			'',
		].join('\n');

		return `${code.slice(0, insertAt)}${appended}${code.slice(script.loc.end.offset)}`;
	}

	const expression = exportAssignment.expression;
	const beforeExport = content.slice(0, exportAssignment.getStart(sourceFile));
	const afterExport = content.slice(exportAssignment.end);
	const componentVariable = '__VUE_INTERNATIONALIZATION_COMPONENT__';
	const replacement = [
		importLine,
		`const ${componentVariable} = ${content.slice(expression.getStart(sourceFile), expression.end)};`,
		`${componentVariable}.$locale = ${localeExpression};`,
		`${componentVariable}.$l = ${localizerExpression};`,
		`export default ${componentVariable};`,
	].join('\n');
	const nextContent = `${beforeExport}${replacement}${afterExport}`;

	return `${code.slice(0, insertAt)}${nextContent}${code.slice(script.loc.end.offset)}`;
}

function mergeLocaleDictionaryInto(target: LocaleDictionary, source: LocaleDictionary): void {
	for (const [key, value] of Object.entries(source)) {
		const current = target[key];

		if (isPlainDictionary(current) && isPlainDictionary(value)) {
			mergeLocaleDictionaryInto(current, value);
			continue;
		}

		target[key] = cloneLocaleValue(value);
	}
}

function cloneLocaleValue(value: LocaleDictionary[string]): LocaleDictionary[string] {
	if (Array.isArray(value)) {
		return value.map((item) => cloneLocaleValue(item));
	}

	if (isPlainDictionary(value)) {
		return mergeLocaleDictionaries(value);
	}

	return value;
}

function isPlainDictionary(value: unknown): value is LocaleDictionary {
	return value != null && typeof value === 'object' && !Array.isArray(value);
}

function visitScriptNode(
	node: ts.Node,
	code: string,
	sourceLabel: string,
	messages: Partial<Record<string, LocaleDictionary>>,
): void {
	if (ts.isCallExpression(node) && isDefineInternationalizationCallee(node.expression)) {
		const [argument] = node.arguments;

		if (ts.isObjectLiteralExpression(argument)) {
			mergeScriptLocaleMessages(messages, parseScriptLocaleRoot(argument, code, sourceLabel));
		}
	}

	ts.forEachChild(node, (child) => visitScriptNode(child, code, sourceLabel, messages));
}

function isDefineInternationalizationCallee(node: ts.Expression): boolean {
	return ts.isIdentifier(node) && node.text === 'defineInternationalization';
}

function mergeScriptLocaleMessages(
	target: Partial<Record<string, LocaleDictionary>>,
	source: Partial<Record<string, LocaleDictionary>>,
): void {
	for (const [locale, dictionary] of Object.entries(source)) {
		target[locale] = mergeLocaleDictionaries(target[locale] ?? {}, dictionary ?? {});
	}
}

function parseScriptLocaleRoot(
	node: ts.ObjectLiteralExpression,
	code: string,
	sourceLabel: string,
): Partial<Record<string, LocaleDictionary>> {
	const result: Partial<Record<string, LocaleDictionary>> = {};

	for (const property of node.properties) {
		if (!ts.isPropertyAssignment(property)) {
			continue;
		}

		const locale = getScriptPropertyName(property.name);
		if (!locale || !ts.isObjectLiteralExpression(property.initializer)) {
			continue;
		}

		result[locale] = validateLocaleDictionary(parseScriptLocaleDictionary(property.initializer, code, sourceLabel), `${sourceLabel}: ${locale}`);
	}

	return result;
}

function parseScriptLocaleDictionary(
	node: ts.ObjectLiteralExpression,
	code: string,
	sourceLabel: string,
): LocaleDictionary {
	const result: LocaleDictionary = {};

	for (const property of node.properties) {
		if (!ts.isPropertyAssignment(property)) {
			continue;
		}

		const key = getScriptPropertyName(property.name);
		if (!key) {
			continue;
		}

		const value = parseScriptLocaleValue(property.initializer, code, sourceLabel);
		if (value !== undefined) {
			result[key] = value;
		}
	}

	return result;
}

function parseScriptLocaleValue(node: ts.Expression, code: string, sourceLabel: string): LocaleDictionary[string] | undefined {
	if (ts.isStringLiteralLike(node)) {
		return node.text;
	}

	if (ts.isNumericLiteral(node)) {
		return Number(node.text);
	}

	if (node.kind === ts.SyntaxKind.TrueKeyword) {
		return true;
	}

	if (node.kind === ts.SyntaxKind.FalseKeyword) {
		return false;
	}

	if (node.kind === ts.SyntaxKind.NullKeyword) {
		return null;
	}

	if (ts.isObjectLiteralExpression(node)) {
		return parseScriptLocaleDictionary(node, code, sourceLabel);
	}

	if (ts.isArrayLiteralExpression(node)) {
		return node.elements
			.map((element) => parseScriptLocaleValue(element, code, sourceLabel))
			.filter((value): value is LocaleDictionary[string] => value !== undefined);
	}

	if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
		return createMessageFunction(node.getText());
	}

	return undefined;
}

function createMessageFunction(source: string): LocaleMessageFunction {
	const expression = transpileScriptExpression(source);
	const message = (() => '') as LocaleMessageFunction;
	Object.defineProperty(message, 'toString', {
		value: () => expression,
	});
	return message;
}

function transpileScriptExpression(source: string): string {
	const output = ts.transpileModule(`const __message = ${source};`, {
		compilerOptions: {
			target: ts.ScriptTarget.ES2020,
			module: ts.ModuleKind.ESNext,
		},
		fileName: 'vite-vue-internationalization-message.ts',
	}).outputText.trim();
	const prefix = 'const __message = ';
	const start = output.indexOf(prefix);
	const end = output.lastIndexOf(';');

	if (start < 0 || end < start) {
		return source;
	}

	return output.slice(start + prefix.length, end).trim();
}

function getScriptPropertyName(name: ts.PropertyName): string | undefined {
	if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
		return name.text;
	}

	return undefined;
}

function findCustomBlockRange(code: string, contentStart: number, contentEnd: number, filename: string) {
	const start = code.lastIndexOf('<locale', contentStart);
	const closeStart = code.indexOf('</locale>', contentEnd);

	if (start < 0 || closeStart < 0) {
		throw new Error(`Unable to locate complete <locale> block in ${filename}.`);
	}

	return {
		start,
		end: closeStart + '</locale>'.length,
	};
}

export function getPrimaryLocaleDictionary(
	blocks: SfcLocaleBlock[],
	primaryLocale: string | undefined,
	scriptMessages: Partial<Record<string, LocaleDictionary>> = {},
): LocaleDictionary {
	const primaryBlock = primaryLocale ? blocks.find((block) => block.locale === primaryLocale) : undefined;
	const scriptLocale = primaryLocale && scriptMessages[primaryLocale] ? primaryLocale : Object.keys(scriptMessages)[0];
	const blockLocale = blocks.length > 0 ? blocks[0].locale : undefined;
	const locale = primaryBlock?.locale ?? blockLocale ?? scriptLocale;

	if (!locale) {
		return {};
	}

	const dictionaries = blocks
		.filter((block) => block.locale === locale)
		.map((block) => parseLocaleDictionary(block.content, block.lang, `<locale locale="${block.locale}">`));

	return mergeLocaleDictionaries(...dictionaries, scriptMessages[locale] ?? {});
}

function isTypeScriptScript(scriptOpenTag: string): boolean {
	return /\blang\s*=\s*["']tsx?["']/.test(scriptOpenTag);
}

function getScriptLangAttribute(scriptOpenTag: string | undefined): string | undefined {
	const lang = scriptOpenTag?.match(/\blang\s*=\s*(["'])(tsx?|jsx?)\1/)?.[0].replace(/\s*$/, '');
	return lang ? ` ${lang}` : undefined;
}
