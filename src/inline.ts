import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { parse } from 'acorn';
import { parse as parseSfc } from '@vue/compiler-sfc';
import { parse as parseIcuMessage, TYPE } from '@formatjs/icu-messageformat-parser';
import { walk } from 'estree-walker';
import MagicString from 'magic-string';
import { compileLocaleMessage } from './message.js';
import { hasLocaleBinding } from './parse.js';
import { injectScriptSetup } from './scriptSetup.js';
import type { Node as EstreeNode } from 'estree-walker';
import type { MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import type { LocaleMessageSyntax, LocaleMessageToken } from './message.js';
import type { LocaleDictionary } from './types.js';

export type InlineLocalePayload = {
	locale: string;
	messageSyntax: LocaleMessageSyntax;
	global: LocaleDictionary;
	module: LocaleDictionary;
};

export type InlineChunkManifest = {
	primaryLocale: string;
	entries: Array<{
		fileName: string;
		originalFileName: string;
		facadeModuleId?: string;
		isEntry?: boolean;
		isDynamicEntry?: boolean;
		imports?: string[];
		dynamicImports?: string[];
		css?: string[];
		locales: Record<string, string>;
	}>;
};

export type InlineLocaleLoaderAsset = {
	fileName: string;
	source: string;
};
type InlineLocaleHtmlOptions = {
	base?: string;
	emitAsset?: InlineLocaleAssetEmitter;
};

type ModuleMessages = Partial<Record<string, Partial<Record<string, LocaleDictionary>>>>;
type LocaleMessages = Partial<Record<string, LocaleDictionary>>;
type PublicLocaleScope = 'env' | 'sfc';
type InlinePayloadResolver = (moduleId: string) => InlineLocalePayload;
type InlinePayloadResolverCache = {
	resolve(locale: string): InlinePayloadResolver;
};
type AstReplaceOptions = {
	localeMembers?: boolean;
	localizerCalls?: boolean;
	textCalls?: boolean;
	objectCalls?: boolean;
	allowMarkerFallback?: boolean;
};
type InlineReplacementPlan = {
	code: string;
	operations: InlineReplacementOperation[];
};
type InlineReplacementOperation =
	| {
		type: 'text-call';
		start: number;
		end: number;
		marker: string;
		path: string;
	}
	| {
		type: 'localizer-call';
		start: number;
		end: number;
		marker: string;
		path: string;
		valuesExpression: string;
		pluralExpression?: string;
	}
	| {
		type: 'lookup-call';
		start: number;
		end: number;
		marker: string;
		path: string;
		keyExpression: string;
		suffixKeys: string[];
	}
	| {
		type: 'locale-object-call';
		start: number;
		end: number;
		marker: string;
	}
	| {
		type: 'localizer-object-call';
		start: number;
		end: number;
		marker: string;
	}
	| {
		type: 'localizer-binding-call';
		start: number;
		end: number;
		marker: string;
		properties: string[];
		valuesExpression: string;
		pluralExpression?: string;
	}
	| {
		type: 'locale-member';
		start: number;
		end: number;
		marker: string;
		properties: string[];
	};
type ParsedLocaleAccess = {
	end: number;
	segments: LocaleAccessSegment[];
	source: string;
};
type LocaleAccessSegment =
	| {
		type: 'static';
		value: string;
	}
	| {
		type: 'dynamic';
		expression: string;
	};
type ParsedInlineJavaScript = {
	ast: AstNode;
	code: string;
};
type AstNode = {
	start: number;
	end: number;
	type: string;
	[key: string]: unknown;
};
type AstIdentifier = AstNode & {
	type: 'Identifier';
	name: string;
};
type AstLiteral = AstNode & {
	type: 'Literal';
	value: unknown;
};
type AstTemplateLiteral = AstNode & {
	type: 'TemplateLiteral';
	expressions: AstNode[];
	quasis: Array<{
		value: {
			cooked?: string | null;
			raw: string;
		};
	}>;
};
type AstMemberExpression = AstNode & {
	type: 'MemberExpression';
	object: AstNode;
	property: AstNode;
	computed: boolean;
};
type AstCallExpression = AstNode & {
	type: 'CallExpression';
	callee: AstNode;
	arguments: AstNode[];
};
type AstVariableDeclarator = AstNode & {
	type: 'VariableDeclarator';
	id: AstNode;
	init?: AstNode | null;
};
type MutableOutputChunk = {
	type: 'chunk';
	fileName: string;
	code: string;
	imports: string[];
	dynamicImports: string[];
	viteMetadata?: {
		importedAssets?: Set<string>;
		importedCss?: Set<string>;
	};
	[key: string]: unknown;
};
type MutableOutputBundle = Record<string, unknown>;
type MutableOutputAsset = {
	type: 'asset';
	fileName: string;
	source: string | Uint8Array;
	names?: string[];
	originalFileNames?: string[];
	[key: string]: unknown;
};
type InlineLocaleChunkEmitter = (chunk: MutableOutputChunk) => void;
type InlineLocaleAssetEmitter = (asset: MutableOutputAsset) => void;
type InlineChunkSnapshot = {
	chunk: MutableOutputChunk;
	originalCode: string;
	originalFileName: string;
	originalImports: string[];
	originalDynamicImports: string[];
};
type InlineChunkReferenceMap = {
	localizeFileName(fileName: string, locale: string): string;
	localizeCodeReferences(code: string, locale: string): string;
	replacePreloadMarkers(code: string, locale: string): string;
};

const INLINE_MARKER_PREFIX = '__VUE_INTERNATIONALIZATION_INLINE__:';
const INLINE_LOCALE_CALL = '__VUE_INTERNATIONALIZATION_INLINE_LOCALE__';
const INLINE_LOCALIZERS_CALL = '__VUE_INTERNATIONALIZATION_INLINE_LOCALIZERS__';
const INLINE_TEXT_CALL = '__VUE_INTERNATIONALIZATION_INLINE_TEXT__';
const INLINE_LOCALIZER_CALL = '__VUE_INTERNATIONALIZATION_INLINE_LOCALIZER__';
const INLINE_LOOKUP_CALL = '__VUE_INTERNATIONALIZATION_INLINE_LOOKUP__';
const INLINE_TEXT_RE =
	/(?:\b[A-Za-z_$][\w$]*\.)?__VUE_INTERNATIONALIZATION_INLINE_TEXT__\((?:"|&quot;)(__VUE_INTERNATIONALIZATION_INLINE__:[A-Za-z0-9+/=]+)(?:"|&quot;),(?:"|&quot;)((?:env|sfc)(?:\.[A-Za-z_$][\w$]*)+)(?:"|&quot;)\)/g;
const INLINE_LOCALIZER_RE =
	/(?:\b[A-Za-z_$][\w$]*\.)?__VUE_INTERNATIONALIZATION_INLINE_LOCALIZER__\((?:"|&quot;)(__VUE_INTERNATIONALIZATION_INLINE__:[A-Za-z0-9+/=]+)(?:"|&quot;),(?:"|&quot;)((?:env|sfc)(?:\.[A-Za-z_$][\w$]*)+)(?:"|&quot;),(\{[^)]*\})\)/g;
const LOCALE_ACCESS_RE = /\$locale(?:\.value)?\.(env|sfc)((?:\.[A-Za-z_$][\w$]*)+)/g;
const LOCALIZER_ACCESS_PREFIX_RE = /\$l(?:\.value)?\.(env|sfc)((?:\.[A-Za-z_$][\w$]*)+)\(/g;
const VUE_DEFAULT_IMPORT_RE = /\bimport\s+([A-Za-z_$][\w$]*)\s+from\s+(["'])([^"']+\.vue(?:\?[^"']*)?)\2/g;

export function createInlineLocaleMarker(moduleId: string): string {
	return `${INLINE_MARKER_PREFIX}${Buffer.from(moduleId, 'utf8').toString('base64')}`;
}

export function injectInlineLocaleBinding(code: string, moduleId: string): string {
	const needsLocaleBinding = !hasLocaleBinding(code, '$locale');
	const needsLocalizerBinding = !hasLocaleBinding(code, '$l');

	if (!needsLocaleBinding && !needsLocalizerBinding) {
		return code;
	}

	const injection = [
		'',
		needsLocaleBinding ? `const $locale = __VUE_INTERNATIONALIZATION_INLINE_LOCALE__(${JSON.stringify(createInlineLocaleMarker(moduleId))});` : '',
		needsLocalizerBinding ? `const $l = __VUE_INTERNATIONALIZATION_INLINE_LOCALIZERS__(${JSON.stringify(createInlineLocaleMarker(moduleId))});` : '',
		'',
	].filter((line, index, lines) => line.length > 0 || index === 0 || index === lines.length - 1).join('\n');

	return injectScriptSetup(code, injection);
}

export function rewriteInlineLocaleTemplateAccess(code: string, moduleId: string): string {
	const marker = createInlineLocaleMarker(moduleId);

	return replaceVueTemplateContent(code, (template) =>
		rewriteTemplateLocaleAccess(rewriteTemplateLocalizerAccess(template, marker), marker),
	);
}

export function rewriteInlineComponentLocaleAccess(code: string, filename: string, root: string): string {
	const imports = collectVueDefaultImports(code, filename, root);

	if (imports.size === 0) {
		return code;
	}

	return rewriteScriptComponentLocaleAccess(
		rewriteTemplateComponentLocaleAccess(code, imports),
		imports,
	);
}

function rewriteTemplateLocalizerAccess(template: string, marker: string): string {
	let next = '';
	let cursor = 0;

	for (const match of template.matchAll(LOCALIZER_ACCESS_PREFIX_RE)) {
		const start = match.index;
		const scope = match[1] as PublicLocaleScope | undefined;
		const pathExpression = match[2];

		if (start < cursor || !scope || !pathExpression) {
			continue;
		}

		const valuesStart = start + match[0].length;
		const callEnd = findBalancedExpressionEnd(template, valuesStart, '(', ')');

		if (callEnd === undefined) {
			continue;
		}

		next += template.slice(cursor, start);
		next += `__VUE_INTERNATIONALIZATION_INLINE_LOCALIZER__(${createTemplateStringArgument(marker)},${createTemplateStringArgument(`${scope}${pathExpression}`)},${template.slice(valuesStart, callEnd)})`;
		cursor = callEnd + 1;
	}

	return cursor === 0 ? template : next + template.slice(cursor);
}

function rewriteTemplateLocaleAccess(template: string, marker: string): string {
	let next = '';
	let cursor = 0;

	for (const match of template.matchAll(/\$locale(?:\.value)?\.(env|sfc)/g)) {
		const start = match.index;
		const scope = match[1] as PublicLocaleScope | undefined;

		if (start < cursor || !scope) {
			continue;
		}

		const access = parseLocaleAccessSegments(template, start + match[0].length);

		if (!access || access.segments.length === 0) {
			continue;
		}

		const replacement = createInlineTemplateAccessReplacement(marker, scope, access);

		if (!replacement) {
			continue;
		}

		next += template.slice(cursor, start);
		next += replacement;
		cursor = access.end;
	}

	return cursor === 0 ? template : next + template.slice(cursor);
}

function createInlineTemplateAccessReplacement(
	marker: string,
	scope: PublicLocaleScope,
	access: ParsedLocaleAccess,
): string | undefined {
	const dynamicIndex = access.segments.findIndex((segment) => segment.type === 'dynamic');

	if (dynamicIndex === -1) {
		const keys = access.segments.map((segment) => segment.type === 'static' ? segment.value : '');
		return `__VUE_INTERNATIONALIZATION_INLINE_TEXT__(${createTemplateStringArgument(marker)},${createTemplateStringArgument(`${scope}.${keys.join('.')}`)})`;
	}

	if (access.segments.findIndex((segment, index) => index > dynamicIndex && segment.type === 'dynamic') !== -1) {
		return undefined;
	}

	const base = access.segments.slice(0, dynamicIndex);
	const dynamic = access.segments[dynamicIndex];
	const suffix = access.segments.slice(dynamicIndex + 1);

	if (dynamic?.type !== 'dynamic' || base.length === 0) {
		return undefined;
	}

	const baseKeys = base.map((segment) => segment.type === 'static' ? segment.value : '');
	const suffixKeys = suffix.map((segment) => segment.type === 'static' ? segment.value : '');
	return `__VUE_INTERNATIONALIZATION_INLINE_LOOKUP__(${createTemplateStringArgument(marker)},${createTemplateStringArgument(`${scope}.${baseKeys.join('.')}`)},${dynamic.expression},${createTemplateStringArgument(suffixKeys.join('.'))})`;
}

function rewriteScriptComponentLocaleAccess(code: string, imports: Map<string, string>): string {
	const template = parseSfc(code).descriptor.template;

	if (!template) {
		return rewriteComponentLocaleAccess(code, imports, false);
	}

	const start = template.loc.start.offset;
	const end = template.loc.end.offset;
	return [
		rewriteComponentLocaleAccess(code.slice(0, start), imports, false),
		code.slice(start, end),
		rewriteComponentLocaleAccess(code.slice(end), imports, false),
	].join('');
}

function rewriteTemplateComponentLocaleAccess(code: string, imports: Map<string, string>): string {
	return replaceVueTemplateContent(code, (template) =>
		rewriteComponentLocaleAccess(template, imports, true),
	);
}

function replaceVueTemplateContent(code: string, replacer: (template: string) => string): string {
	const template = parseSfc(code).descriptor.template;

	if (!template) {
		return code;
	}

	const start = template.loc.start.offset;
	const end = template.loc.end.offset;
	return code.slice(0, start) + replacer(code.slice(start, end)) + code.slice(end);
}

function splitCallableLocalePath(pathExpression: string, end: number, source: string): { pathExpression: string; suffix: string } {
	if (source[end] !== '(') {
		return { pathExpression, suffix: '' };
	}

	const lastDot = pathExpression.lastIndexOf('.');

	return lastDot > 0
		? { pathExpression: pathExpression.slice(0, lastDot), suffix: pathExpression.slice(lastDot) }
		: { pathExpression, suffix: '' };
}

function parseLocaleAccessSegments(source: string, start: number): ParsedLocaleAccess | undefined {
	const segments: LocaleAccessSegment[] = [];
	let cursor = start;

	while (cursor < source.length) {
		if (source[cursor] === '.') {
			const identifier = readIdentifier(source, cursor + 1);

			if (!identifier) {
				break;
			}

			if (source[identifier.end] === '(') {
				break;
			}

			segments.push({ type: 'static', value: identifier.value });
			cursor = identifier.end;
			continue;
		}

		if (source[cursor] === '[') {
			const end = findBalancedExpressionEnd(source, cursor + 1, '[', ']');

			if (end === undefined) {
				break;
			}

			const expression = source.slice(cursor + 1, end);
			const staticKey = parseStaticPropertyKey(expression);
			segments.push(staticKey === undefined
				? { type: 'dynamic', expression }
				: { type: 'static', value: staticKey });
			cursor = end + 1;
			continue;
		}

		break;
	}

	if (segments.length === 0) {
		return undefined;
	}

	return {
		end: cursor,
		segments,
		source: source.slice(start, cursor),
	};
}

function readIdentifier(source: string, start: number): { value: string; end: number } | undefined {
	const match = /^[A-Za-z_$][\w$]*/.exec(source.slice(start));

	return match
		? { value: match[0], end: start + match[0].length }
		: undefined;
}

function parseStaticPropertyKey(expression: string): string | undefined {
	const trimmed = expression.trim();

	if (/^`[^`$]*`$/u.test(trimmed)) {
		return trimmed.slice(1, -1);
	}

	if (/^"([^"\\]|\\.)*"$/u.test(trimmed)) {
		return JSON.parse(trimmed) as string;
	}

	const singleQuoted = /^'((?:[^'\\]|\\.)*)'$/u.exec(trimmed);

	if (singleQuoted) {
		return singleQuoted[1]
			.replaceAll("\\'", "'")
			.replaceAll('\\\\', '\\');
	}
}

function rewriteComponentLocaleAccess(code: string, imports: Map<string, string>, htmlEscaped: boolean): string {
	let next = code;

	for (const [name, moduleId] of imports) {
		const marker = createInlineLocaleMarker(moduleId);
		next = rewriteComponentLocalizerAccess(next, name, marker, htmlEscaped);
		next = rewriteComponentLocaleMemberAccess(next, name, marker, htmlEscaped);
	}

	return next;
}

function rewriteComponentLocaleMemberAccess(code: string, name: string, marker: string, htmlEscaped: boolean): string {
	const stringArgument = htmlEscaped ? createTemplateStringArgument : JSON.stringify;
	const regexp = new RegExp(`\\b${escapeRegExp(name)}\\.\\$locale((?:\\.[A-Za-z_$][\\w$]*)+)`, 'g');

	return code.replace(regexp, (_match, pathExpression: string) =>
		`__VUE_INTERNATIONALIZATION_INLINE_TEXT__(${stringArgument(marker)},${stringArgument(`sfc${pathExpression}`)})`,
	);
}

function rewriteComponentLocalizerAccess(code: string, name: string, marker: string, htmlEscaped: boolean): string {
	const stringArgument = htmlEscaped ? createTemplateStringArgument : JSON.stringify;
	const regexp = new RegExp(`\\b${escapeRegExp(name)}\\.\\$l((?:\\.[A-Za-z_$][\\w$]*)+)\\(`, 'g');
	let next = '';
	let cursor = 0;

	for (const match of code.matchAll(regexp)) {
		const start = match.index;
		const pathExpression = match[1];

		if (start < cursor || !pathExpression) {
			continue;
		}

		const valuesStart = start + match[0].length;
		const callEnd = findBalancedExpressionEnd(code, valuesStart, '(', ')');

		if (callEnd === undefined) {
			continue;
		}

		next += code.slice(cursor, start);
		next += `__VUE_INTERNATIONALIZATION_INLINE_LOCALIZER__(${stringArgument(marker)},${stringArgument(`sfc${pathExpression}`)},${code.slice(valuesStart, callEnd)})`;
		cursor = callEnd + 1;
	}

	return cursor === 0 ? code : next + code.slice(cursor);
}

function collectVueDefaultImports(code: string, filename: string, root: string): Map<string, string> {
	const imports = new Map<string, string>();

	for (const match of code.matchAll(VUE_DEFAULT_IMPORT_RE)) {
		const name = match[1];
		const source = match[3];

		if (!name || !source) {
			continue;
		}

		const resolved = resolveVueImport(filename, source);

		if (!resolved || !isLocaleOnlyVueFile(resolved)) {
			continue;
		}

		const moduleId = toRuntimeModuleId(resolved, root);

		if (moduleId) {
			imports.set(name, moduleId);
		}
	}

	return imports;
}

function resolveVueImport(filename: string, source: string): string | undefined {
	const sourcePath = source.split('?', 1)[0] ?? source;

	if (!sourcePath.startsWith('.') && !sourcePath.startsWith('/') && !isAbsolute(sourcePath)) {
		return undefined;
	}

	const resolved = isAbsolute(sourcePath)
		? sourcePath
		: resolve(dirname(filename), sourcePath);

	return resolved;
}

function toRuntimeModuleId(filename: string, root: string): string {
	const relativePath = relative(resolve(root), filename);

	return `/${normalizePath(relativePath)}`;
}

function isLocaleOnlyVueFile(filename: string): boolean {
	if (!existsSync(filename)) {
		return false;
	}

	const descriptor = parseSfc(readFileSync(filename, 'utf8'), { filename }).descriptor;

	return !descriptor.template &&
		!descriptor.script &&
		!descriptor.scriptSetup &&
		descriptor.customBlocks.some((block) => block.type === 'locale');
}

function createTemplateStringArgument(value: string): string {
	return JSON.stringify(value).replaceAll('"', '&quot;');
}

function findBalancedExpressionEnd(source: string, start: number, open: string, close: string): number | undefined {
	let depth = 1;
	let quote: '"' | '\'' | '`' | undefined;
	let escaped = false;

	for (let index = start; index < source.length; index++) {
		const char = source[index];

		if (quote) {
			if (escaped) {
				escaped = false;
				continue;
			}

			if (char === '\\') {
				escaped = true;
				continue;
			}

			if (char === quote) {
				quote = undefined;
			}

			continue;
		}

		if (char === '"' || char === '\'' || char === '`') {
			quote = char;
			continue;
		}

		if (char === open) {
			depth++;
			continue;
		}

		if (char === close) {
			depth--;

			if (depth === 0) {
				return index;
			}
		}
	}
}

export function inlineLocaleChunks(
	bundle: MutableOutputBundle,
	locales: string[],
	primaryLocale: string,
	modules: ModuleMessages,
	globalMessages: LocaleMessages,
	messageSyntax: LocaleMessageSyntax = 'vue',
	options: {
		emitChunk?: InlineLocaleChunkEmitter;
	} = {},
): InlineChunkManifest {
	const manifest: InlineChunkManifest = {
		primaryLocale,
		entries: [],
	};
	const chunks = Object.values(bundle)
		.filter((chunk): chunk is MutableOutputChunk => isMutableOutputChunk(chunk))
		.map((chunk) => ({
			chunk,
			originalCode: chunk.code,
			originalFileName: chunk.fileName,
			originalImports: [...chunk.imports],
			originalDynamicImports: [...chunk.dynamicImports],
		}));
	const localizableFiles = collectLocalizableChunkFiles(chunks);
	const referenceMap = createInlineChunkReferenceMap(chunks, localizableFiles);
	const localizableChunks = chunks
		.filter(({ originalFileName }) => localizableFiles.has(originalFileName))
		.map((chunk) => ({
			...chunk,
			plan: createRequiredInlineReplacementPlan(chunk.originalCode),
		}));
	const payloadCache = createInlinePayloadResolverCache(primaryLocale, messageSyntax, modules, globalMessages);

	for (const { chunk, originalCode, plan, originalFileName, originalImports, originalDynamicImports } of localizableChunks) {
		const primaryFileName = addLocaleToFileName(originalFileName, primaryLocale);
		const localeFiles: Record<string, string> = {
			[primaryLocale]: primaryFileName,
		};

		for (const locale of locales) {
			const localizedChunk: MutableOutputChunk = locale === primaryLocale ? chunk : {
				...chunk,
				fileName: addLocaleToFileName(originalFileName, locale),
			};

			localizedChunk.fileName = addLocaleToFileName(originalFileName, locale);
			localizedChunk.imports = originalImports.map((fileName) => referenceMap.localizeFileName(fileName, locale));
			localizedChunk.dynamicImports = originalDynamicImports.map((fileName) =>
				referenceMap.localizeFileName(fileName, locale),
			);
			localizedChunk.code = referenceMap.replacePreloadMarkers(
				referenceMap.localizeCodeReferences(
					applyInlineReplacementPlan(originalCode, plan, payloadCache.resolve(locale)),
					locale,
				),
				locale,
			);

			if (options.emitChunk) {
				options.emitChunk(localizedChunk);
			} else {
				bundle[localizedChunk.fileName] = localizedChunk;
			}
			localeFiles[locale] = localizedChunk.fileName;
		}

		delete bundle[originalFileName];
		manifest.entries.push({
			fileName: primaryFileName,
			originalFileName,
			facadeModuleId: typeof chunk.facadeModuleId === 'string' ? chunk.facadeModuleId : undefined,
			isEntry: typeof chunk.isEntry === 'boolean' ? chunk.isEntry : undefined,
			isDynamicEntry: typeof chunk.isDynamicEntry === 'boolean' ? chunk.isDynamicEntry : undefined,
			imports: originalImports.length > 0 ? originalImports : undefined,
			dynamicImports: originalDynamicImports.length > 0 ? originalDynamicImports : undefined,
			css: [...(chunk.viteMetadata?.importedCss ?? [])],
			locales: localeFiles,
		});
	}

	return manifest;
}

function collectLocalizableChunkFiles(chunks: Array<{
	originalCode: string;
	originalFileName: string;
	originalImports: string[];
	originalDynamicImports: string[];
}>): Set<string> {
	const localizableFiles = new Set(chunks
		.filter(({ originalCode }) => originalCode.includes(INLINE_MARKER_PREFIX))
		.map(({ originalFileName }) => originalFileName));
	let changed = true;

	while (changed) {
		changed = false;

		for (const chunk of chunks) {
			if (localizableFiles.has(chunk.originalFileName)) {
				continue;
			}

			if (getLocalizableChunkReferences(
				chunk.originalCode,
				chunk.originalImports,
				chunk.originalDynamicImports,
				localizableFiles,
			).size > 0) {
				localizableFiles.add(chunk.originalFileName);
				changed = true;
			}
		}
	}

	return localizableFiles;
}

export function replaceInlineLocaleMarkers(
	code: string,
	locale: string,
	primaryLocale: string,
	messageSyntax: LocaleMessageSyntax,
	modules: ModuleMessages,
	globalMessages: LocaleMessages,
	parsed?: ParsedInlineJavaScript,
): string {
	const resolvePayload = createInlinePayloadResolver(locale, primaryLocale, messageSyntax, modules, globalMessages);

	return replaceInlineLocaleAccessAst(code, resolvePayload, {
		localeMembers: true,
		localizerCalls: true,
		textCalls: true,
		objectCalls: true,
	}, parsed);
}

export function replaceInlineLocalizerAccess(
	code: string,
	locale: string,
	primaryLocale: string,
	modules: ModuleMessages,
	globalMessages: LocaleMessages,
	messageSyntax: LocaleMessageSyntax = 'vue',
): string {
	return replaceInlineLocalizerAccessWithResolver(
		code,
		createInlinePayloadResolver(locale, primaryLocale, messageSyntax, modules, globalMessages),
	);
}

function replaceInlineLocalizerAccessWithResolver(code: string, resolvePayload: InlinePayloadResolver): string {
	return replaceInlineLocaleAccessAst(code, resolvePayload, {
		localizerCalls: true,
		allowMarkerFallback: true,
	});
}

export function replaceInlineLocaleTextAccess(
	code: string,
	locale: string,
	primaryLocale: string,
	modules: ModuleMessages,
	globalMessages: LocaleMessages,
	messageSyntax: LocaleMessageSyntax = 'vue',
): string {
	return replaceInlineLocaleTextAccessWithResolver(
		code,
		createInlinePayloadResolver(locale, primaryLocale, messageSyntax, modules, globalMessages),
	);
}

function replaceInlineLocaleTextAccessWithResolver(code: string, resolvePayload: InlinePayloadResolver): string {
	return replaceInlineLocaleAccessAst(code, resolvePayload, {
		textCalls: true,
		allowMarkerFallback: true,
	});
}

export function replaceInlineLocaleMemberAccess(
	code: string,
	locale: string,
	primaryLocale: string,
	modules: ModuleMessages,
	globalMessages: LocaleMessages,
	messageSyntax: LocaleMessageSyntax = 'vue',
): string {
	return replaceInlineLocaleMemberAccessWithResolver(
		code,
		createInlinePayloadResolver(locale, primaryLocale, messageSyntax, modules, globalMessages),
	);
}

function replaceInlineLocaleMemberAccessWithResolver(code: string, resolvePayload: InlinePayloadResolver): string {
	return replaceInlineLocaleAccessAst(code, resolvePayload, {
		localeMembers: true,
	});
}

export function inlineLocaleHtml(
	bundle: MutableOutputBundle,
	manifest: InlineChunkManifest,
	options: InlineLocaleHtmlOptions = {},
): void {
	const base = options.base ?? '/';

	for (const asset of Object.values(bundle)) {
		if (!isMutableOutputAsset(asset) || typeof asset.source !== 'string' || !asset.fileName.endsWith('.html')) {
			continue;
		}

		for (const loader of getInlineLocaleHtmlLoaders(asset.source, manifest, asset.fileName, base)) {
			const loaderAsset: MutableOutputAsset = {
				type: 'asset',
				fileName: loader.fileName,
				names: [],
				originalFileNames: [],
				source: loader.source,
			};
			if (options.emitAsset) {
				options.emitAsset(loaderAsset);
			} else {
				bundle[loader.fileName] = loaderAsset;
			}
		}

		asset.source = replaceInlineLocaleHtml(asset.source, manifest, asset.fileName, base);
	}
}

export function getInlineLocaleHtmlLoaders(
	html: string,
	manifest: InlineChunkManifest,
	htmlFileName?: string,
	base = '/',
): InlineLocaleLoaderAsset[] {
	return findHtmlLocaleEntries(html, manifest, htmlFileName, base).map((entry) => ({
		fileName: createLocaleLoaderFileName(entry.originalFileName),
		source: createLocaleLoaderSource(entry.locales, manifest.primaryLocale, base),
	}));
}

export function replaceInlineLocaleHtml(
	html: string,
	manifest: InlineChunkManifest,
	htmlFileName?: string,
	base = '/',
): string {
	let next = html;
	const fallbackEntries = findFallbackHtmlLocaleEntries(html, manifest, htmlFileName, base);

	for (const entry of manifest.entries) {
		const replaced = replaceEntryScript(next, entry.locales, manifest.primaryLocale, base);
		next = replaced === next && fallbackEntries.includes(entry)
			? injectLocaleLoaderScript(next, entry, manifest.primaryLocale, base)
			: replaced;
	}

	return next;
}

export function augmentViteManifestJson(source: string, inlineManifest: InlineChunkManifest): string {
	const manifest = JSON.parse(source) as Record<string, Record<string, unknown>>;
	const fileToManifestKey = new Map(Object.entries(manifest)
		.flatMap(([key, value]) => typeof value.file === 'string' ? [[value.file, key] as const] : []));

	for (const entry of inlineManifest.entries) {
		const manifestEntry = findManifestEntry(manifest, entry);

		if (!manifestEntry) {
			continue;
		}

		const [key, value] = manifestEntry;
		const originalFile = typeof value.file === 'string' ? value.file : undefined;

		value.file = entry.locales[inlineManifest.primaryLocale];
		value.locale = inlineManifest.primaryLocale;
		value.isEntry ??= true;
		const imports = mapManifestImports(entry.imports, fileToManifestKey);
		const dynamicImports = mapManifestImports(entry.dynamicImports, fileToManifestKey);

		if (imports.length > 0) {
			value.imports = imports;
		}

		if (dynamicImports.length > 0) {
			value.dynamicImports = dynamicImports;
		}

		if (originalFile?.endsWith('.css')) {
			const css = Array.isArray(value.css) ? value.css : [];
			value.css = [originalFile, ...css.filter((file): file is string => typeof file === 'string' && file !== originalFile)];
		}

		value.internationalization = {
			primaryLocale: inlineManifest.primaryLocale,
			locales: entry.locales,
		};

		for (const [locale, fileName] of Object.entries(entry.locales)) {
			manifest[`${key}?locale=${locale}`] = {
				...value,
				file: fileName,
				locale,
				isInternationalizationLocale: true,
			};
		}
	}

	return `${JSON.stringify(manifest, null, 2)}\n`;
}

function mapManifestImports(
	fileNames: string[] | undefined,
	fileToManifestKey: Map<string, string>,
): string[] {
	return fileNames
		?.map((fileName) => fileToManifestKey.get(fileName))
		.filter((key): key is string => typeof key === 'string') ?? [];
}

export function addLocaleToFileName(fileName: string, locale: string): string {
	return fileName.replace(/(\.m?js)$/u, `.${sanitizeLocale(locale)}$1`);
}

function getLocalizableChunkReferences(
	code: string,
	imports: string[],
	dynamicImports: string[],
	localizableFiles: Set<string>,
): Set<string> {
	const references = new Set(
		[...imports, ...dynamicImports]
			.filter((fileName) => localizableFiles.has(fileName)),
	);
	const localizableFilesByBaseName = new Map([...localizableFiles].map((fileName) => [baseName(fileName), fileName]));

	for (const match of code.matchAll(/[A-Za-z0-9._-]+\.m?js/gu)) {
		const fileName = localizableFilesByBaseName.get(match[0]);

		if (fileName) {
			references.add(fileName);
		}
	}

	return references;
}

function createInlineChunkReferenceMap(
	chunks: InlineChunkSnapshot[],
	localizableFiles: Set<string>,
): InlineChunkReferenceMap {
	const chunksByOriginalFileName = new Map(chunks.map((chunk) => [chunk.originalFileName, chunk]));

	function localizeFileName(fileName: string, locale: string): string {
		return localizableFiles.has(fileName) ? addLocaleToFileName(fileName, locale) : fileName;
	}

	function findOriginalFileName(specifier: string, locale: string): string | undefined {
		const normalized = specifier.replace(/^\.\//u, '');

		for (const fileName of chunksByOriginalFileName.keys()) {
			const localizedFileName = addLocaleToFileName(fileName, locale);

			if (
				normalized === fileName ||
				normalized === localizedFileName ||
				normalized === baseName(fileName) ||
				normalized === baseName(localizedFileName)
			) {
				return fileName;
			}
		}

		return undefined;
	}

	function localizeCodeReferences(code: string, locale: string): string {
		let next = code;

		for (const fileName of localizableFiles) {
			const localizedFileName = addLocaleToFileName(fileName, locale);

			next = next.replaceAll(fileName, localizedFileName);
			next = next.replaceAll(baseName(fileName), baseName(localizedFileName));
		}

		return next;
	}

	function collectPreloadDependencies(fileName: string, locale: string, seen = new Set<string>()): string[] {
		if (seen.has(fileName)) {
			return [];
		}
		seen.add(fileName);

		const chunk = chunksByOriginalFileName.get(fileName);
		const dependencies = new Set<string>();

		if (!chunk) {
			dependencies.add(localizeFileName(fileName, locale));
			return [...dependencies];
		}

		if (!isCssOnlyProxyChunk(chunk)) {
			dependencies.add(localizeFileName(fileName, locale));
		}

		for (const css of chunk.chunk.viteMetadata?.importedCss ?? []) {
			dependencies.add(css);
		}

		for (const asset of chunk.chunk.viteMetadata?.importedAssets ?? []) {
			dependencies.add(asset);
		}

		for (const importedFileName of chunk.originalImports) {
			dependencies.add(localizeFileName(importedFileName, locale));

			for (const dependency of collectPreloadDependencies(importedFileName, locale, seen)) {
				dependencies.add(dependency);
			}
		}

		return [...dependencies];
	}

	function replacePreloadMarkers(code: string, locale: string): string {
		return code
			.replace(/(import\(\s*(["'`])\.\/([^"'`]+)\2\s*\)(?:(?!,\s*__VITE_PRELOAD__)[\s\S])*?)(\s*,\s*)__VITE_PRELOAD__/gu, (
				_match,
				importExpression: string,
				_quote: string,
				specifier: string,
				separator: string,
			) => {
				const fileName = findOriginalFileName(specifier, locale);
				const dependencies = fileName ? collectPreloadDependencies(fileName, locale) : [specifier];
				const preloadTarget = fileName && isCssOnlyProxyChunk(chunksByOriginalFileName.get(fileName))
					? 'Promise.resolve({})'
					: importExpression;

				return `${preloadTarget}${separator}${JSON.stringify(dependencies)}`;
			})
			.replaceAll('__VITE_PRELOAD__', '[]');
	}

	return {
		localizeFileName,
		localizeCodeReferences,
		replacePreloadMarkers,
	};
}

function isCssOnlyProxyChunk(chunk?: InlineChunkSnapshot): boolean {
	if (!chunk) {
		return false;
	}

	const hasCssOrAssets = (chunk.chunk.viteMetadata?.importedCss?.size ?? 0) > 0 ||
		(chunk.chunk.viteMetadata?.importedAssets?.size ?? 0) > 0;

	if (!hasCssOrAssets || chunk.originalImports.length > 0 || chunk.originalDynamicImports.length > 0) {
		return false;
	}

	return /^\s*(?:export\s+default\s+["']["'];?)?\s*$/u.test(chunk.originalCode);
}

function createInlinePayloadResolver(
	locale: string,
	primaryLocale: string,
	messageSyntax: LocaleMessageSyntax,
	modules: ModuleMessages,
	globalMessages: LocaleMessages,
): InlinePayloadResolver {
	return createInlinePayloadResolverCache(primaryLocale, messageSyntax, modules, globalMessages).resolve(locale);
}

function createInlinePayloadResolverCache(
	primaryLocale: string,
	messageSyntax: LocaleMessageSyntax,
	modules: ModuleMessages,
	globalMessages: LocaleMessages,
): InlinePayloadResolverCache {
	const globalsByLocale = new Map<string, LocaleDictionary>();
	const modulesByLocaleAndId = new Map<string, LocaleDictionary>();

	const resolveGlobal = (locale: string): LocaleDictionary => {
		let global = globalsByLocale.get(locale);

		if (!global) {
			global = mergeWithPrimary(globalMessages[locale], globalMessages[primaryLocale]);
			globalsByLocale.set(locale, global);
		}

		return global;
	};

	const resolveModule = (locale: string, moduleId: string): LocaleDictionary => {
		const key = `${locale}\0${moduleId}`;
		let module = modulesByLocaleAndId.get(key);

		if (!module) {
			module = mergeWithPrimary(modules[moduleId]?.[locale], modules[moduleId]?.[primaryLocale]);
			modulesByLocaleAndId.set(key, module);
		}

		return module;
	};

	return {
		resolve(locale) {
			const global = resolveGlobal(locale);

			return (moduleId) => ({
				locale,
				messageSyntax,
				global,
				module: resolveModule(locale, moduleId),
			});
		},
	};
}

function replaceInlineLocaleAccessAst(
	code: string,
	resolvePayload: InlinePayloadResolver,
	options: AstReplaceOptions,
	parsed?: ParsedInlineJavaScript,
): string {
	const parsedCode = parsed?.code === code ? parsed : parseInlineJavaScript(code, resolvePayload, options);

	if (typeof parsedCode === 'string') {
		return parsedCode;
	}

	return applyInlineReplacementPlan(
		code,
		createInlineReplacementPlan(code, options, parsedCode),
		resolvePayload,
	);
}

function createRequiredInlineReplacementPlan(code: string): InlineReplacementPlan {
	return createInlineReplacementPlan(code, {
		localeMembers: true,
		localizerCalls: true,
		textCalls: true,
		objectCalls: true,
	}, parseRequiredInlineJavaScript(code));
}

function createInlineReplacementPlan(
	code: string,
	options: AstReplaceOptions,
	parsed?: ParsedInlineJavaScript,
): InlineReplacementPlan {
	const parsedCode = parsed?.code === code ? parsed : parseInlineJavaScript(code, undefined, options);

	if (typeof parsedCode === 'string') {
		throw new Error('Expected inline JavaScript parser to return an AST.');
	}

	const localeBindings = new Map<string, string>();
	const localizerBindings = new Map<string, string>();
	const operations: InlineReplacementOperation[] = [];

	walk(parsedCode.ast as unknown as EstreeNode, {
		enter(node, parent) {
			const current = toAstNode(node);
			const currentParent = parent ? toAstNode(parent) : undefined;

			if (!current) {
				return;
			}

			if (isVariableDeclarator(current)) {
				collectInlineBindingMarker(current, localeBindings, localizerBindings);
				return;
			}

			if (isCallExpression(current)) {
				const operation = getCallReplacementOperation(code, current, localizerBindings, options);

				if (operation) {
					operations.push(operation);
					this.skip();
				}

				return;
			}

			if (
				options.localeMembers === true &&
				isMemberExpression(current) &&
				!isCallCallee(current, currentParent)
			) {
				const operation = getLocaleMemberReplacementOperation(current, localeBindings);

				if (operation) {
					operations.push(operation);
					this.skip();
				}
			}
		},
	});

	return {
		code,
		operations,
	};
}

function applyInlineReplacementPlan(
	code: string,
	plan: InlineReplacementPlan,
	resolvePayload: InlinePayloadResolver,
): string {
	if (plan.code !== code) {
		return replaceInlineLocaleAccessAst(code, resolvePayload, {
			localeMembers: true,
			localizerCalls: true,
			textCalls: true,
			objectCalls: true,
		});
	}

	const magic = new MagicString(code);

	for (const operation of plan.operations) {
		const replacement = getPlannedReplacement(operation, resolvePayload);

		if (replacement !== undefined) {
			magic.overwrite(operation.start, operation.end, replacement);
		}
	}

	return magic.toString();
}

function parseInlineJavaScript(
	code: string,
	resolvePayload: InlinePayloadResolver | undefined,
	options: AstReplaceOptions,
): ParsedInlineJavaScript | string {
	try {
		return {
			ast: parse(code, {
				ecmaVersion: 'latest',
				sourceType: 'module',
				allowHashBang: true,
			}) as unknown as AstNode,
			code,
		};
	} catch (error) {
		if (options.allowMarkerFallback === true && resolvePayload) {
			return parseLegacyInlineMarkerFallback(code, resolvePayload, options);
		}

		throw error;
	}
}

function parseRequiredInlineJavaScript(code: string): ParsedInlineJavaScript {
	const parsed = parseInlineJavaScript(code, undefined, {});

	if (typeof parsed === 'string') {
		throw new Error('Expected inline JavaScript parser to return an AST.');
	}

	return parsed;
}

function parseLegacyInlineMarkerFallback(
	code: string,
	resolvePayload: InlinePayloadResolver,
	options: AstReplaceOptions,
): string {
	let next = code;

	if (options.textCalls === true) {
		next = next.replaceAll(INLINE_TEXT_RE, (_match, marker: string, path: string) => {
			const resolved = resolveInlinePath(marker, path, resolvePayload);
			return resolved ? JSON.stringify(resolved.value ?? `$locale.${path}`) : _match;
		});
	}

	if (options.localizerCalls === true) {
		next = next.replaceAll(INLINE_LOCALIZER_RE, (_match, marker: string, path: string, valuesExpression: string) => {
			const resolved = resolveInlinePath(marker, path, resolvePayload);

			if (!resolved) {
				return _match;
			}

			if (typeof resolved.value === 'function') {
				return `((${resolved.value.toString()})(${valuesExpression}))`;
			}

			const template = typeof resolved.value === 'string' ? resolved.value : `$locale.${path}`;
			return createInlineTemplateExpression(template, valuesExpression, resolvePayload(decodeInlineLocaleMarker(marker)), resolved.scope);
		});
	}

	return next;
}

function collectInlineBindingMarker(
	node: AstVariableDeclarator,
	localeBindings: Map<string, string>,
	localizerBindings: Map<string, string>,
): void {
	if (!isIdentifier(node.id) || !node.init || !isCallExpression(node.init)) {
		return;
	}

	const marker = getStringArgument(node.init, 0);

	if (!marker || !isInlineLocaleMarker(marker)) {
		return;
	}

	const calleeName = getCalleeName(node.init.callee);

	if (calleeName === INLINE_LOCALE_CALL) {
		localeBindings.set(node.id.name, marker);
		return;
	}

	if (calleeName === INLINE_LOCALIZERS_CALL) {
		localizerBindings.set(node.id.name, marker);
	}
}

function getCallReplacementOperation(
	code: string,
	node: AstCallExpression,
	localizerBindings: Map<string, string>,
	options: AstReplaceOptions,
): InlineReplacementOperation | undefined {
	const calleeName = getCalleeName(node.callee);

	if (options.textCalls === true && calleeName === INLINE_TEXT_CALL) {
		return getInlineTextCallReplacementOperation(node);
	}

	if (options.localizerCalls === true && calleeName === INLINE_LOCALIZER_CALL) {
		return getInlineLocalizerCallReplacementOperation(code, node);
	}

	if (options.textCalls === true && calleeName === INLINE_LOOKUP_CALL) {
		return getInlineLookupCallReplacementOperation(code, node);
	}

	if (options.objectCalls === true && calleeName === INLINE_LOCALE_CALL) {
		return getInlineLocaleObjectReplacementOperation(node);
	}

	if (options.objectCalls === true && calleeName === INLINE_LOCALIZERS_CALL) {
		return getInlineLocalizerObjectReplacementOperation(node);
	}

	if (options.localizerCalls === true) {
		return getLocalizerBindingCallReplacementOperation(code, node, localizerBindings);
	}
}

function getInlineTextCallReplacementOperation(node: AstCallExpression): InlineReplacementOperation | undefined {
	const marker = getStringArgument(node, 0);
	const path = getStringArgument(node, 1);

	if (!marker || !isInlineLocaleMarker(marker) || !path) {
		return undefined;
	}

	return {
		type: 'text-call',
		start: node.start,
		end: node.end,
		marker,
		path,
	};
}

function getInlineLocalizerCallReplacementOperation(
	code: string,
	node: AstCallExpression,
): InlineReplacementOperation | undefined {
	const marker = getStringArgument(node, 0);
	const path = getStringArgument(node, 1);
	const values = node.arguments.at(2);

	if (!marker || !isInlineLocaleMarker(marker) || !path) {
		return undefined;
	}

	const plural = node.arguments.at(3);

	return {
		type: 'localizer-call',
		start: node.start,
		end: node.end,
		marker,
		path,
		valuesExpression: values ? code.slice(values.start, values.end) : '{}',
		pluralExpression: plural ? code.slice(plural.start, plural.end) : undefined,
	};
}

function getInlineLookupCallReplacementOperation(
	code: string,
	node: AstCallExpression,
): InlineReplacementOperation | undefined {
	const marker = getStringArgument(node, 0);
	const path = getStringArgument(node, 1);
	const key = node.arguments.at(2);
	const suffix = getStringArgument(node, 3) ?? '';

	if (!marker || !isInlineLocaleMarker(marker) || !path || !key) {
		return undefined;
	}

	return {
		type: 'lookup-call',
		start: node.start,
		end: node.end,
		marker,
		path,
		keyExpression: code.slice(key.start, key.end),
		suffixKeys: suffix === '' ? [] : suffix.split('.'),
	};
}

function createInlineLookupExpression(
	dictionary: LocaleDictionary,
	keyExpression: string,
	suffixKeys: string[],
	payload: InlineLocalePayload,
	scope: PublicLocaleScope,
): string {
	const entries = Object.entries(dictionary)
		.map(([key, value]) => {
			const selected = suffixKeys.length > 0 && isDictionary(value)
				? getValueByPath(value, suffixKeys)
				: value;

			if (selected === undefined) {
				return undefined;
			}

			return `${JSON.stringify(key)}:${serializeInlineLookupValue(selected, payload, scope)}`;
		})
		.filter((entry): entry is string => entry !== undefined)
		.join(',');

	return `(({${entries}})[String(${keyExpression})])`;
}

function serializeInlineLookupValue(value: unknown, payload: InlineLocalePayload, scope: PublicLocaleScope): string {
	if (isDictionary(value)) {
		return `{${Object.entries(value)
			.map(([key, child]) => `${toObjectPropertyName(key)}:${serializeInlineLookupValue(child, payload, scope)}`)
			.join(',')}}`;
	}

	if (typeof value === 'function') {
		return `(${value.toString()})`;
	}

	if (typeof value === 'string') {
		return createInlineTemplateExpression(value, '{}', payload, scope);
	}

	return JSON.stringify(value);
}

function replaceNestedInlineMarkerExpression(expression: string, resolvePayload: InlinePayloadResolver): string {
	const wrapped = `(${expression})`;
	let replaced: string;

	try {
		replaced = replaceInlineLocaleAccessAst(wrapped, resolvePayload, {
			localeMembers: true,
			localizerCalls: true,
			textCalls: true,
			objectCalls: true,
		});
	} catch {
		return expression;
	}

	return replaced.startsWith('(') && replaced.endsWith(')')
		? replaced.slice(1, -1)
		: expression;
}

function getInlineLocaleObjectReplacementOperation(node: AstCallExpression): InlineReplacementOperation | undefined {
	const marker = getStringArgument(node, 0);

	if (!marker || !isInlineLocaleMarker(marker)) {
		return undefined;
	}

	return {
		type: 'locale-object-call',
		start: node.start,
		end: node.end,
		marker,
	};
}

function getInlineLocalizerObjectReplacementOperation(node: AstCallExpression): InlineReplacementOperation | undefined {
	const marker = getStringArgument(node, 0);

	if (!marker || !isInlineLocaleMarker(marker)) {
		return undefined;
	}

	return {
		type: 'localizer-object-call',
		start: node.start,
		end: node.end,
		marker,
	};
}

function getLocalizerBindingCallReplacementOperation(
	code: string,
	node: AstCallExpression,
	localizerBindings: Map<string, string>,
): InlineReplacementOperation | undefined {
	const access = readMemberAccess(node.callee);
	const values = node.arguments.at(0);

	if (!access) {
		return undefined;
	}

	const marker = localizerBindings.get(access.root);

	if (!marker) {
		return undefined;
	}

	const normalized = normalizeInlineAccessPath(access.properties);

	if (!normalized) {
		return undefined;
	}

	const plural = node.arguments.at(1);

	return {
		type: 'localizer-binding-call',
		start: node.start,
		end: node.end,
		marker,
		properties: access.properties,
		valuesExpression: values ? code.slice(values.start, values.end) : '{}',
		pluralExpression: plural ? code.slice(plural.start, plural.end) : undefined,
	};
}

function getLocaleMemberReplacementOperation(
	node: AstMemberExpression,
	localeBindings: Map<string, string>,
): InlineReplacementOperation | undefined {
	const access = readMemberAccess(node);

	if (!access) {
		return undefined;
	}

	const marker = localeBindings.get(access.root);

	if (!marker) {
		return undefined;
	}

	const normalized = normalizeInlineAccessPath(access.properties);

	if (!normalized) {
		return undefined;
	}

	return {
		type: 'locale-member',
		start: node.start,
		end: node.end,
		marker,
		properties: access.properties,
	};
}

function getPlannedReplacement(
	operation: InlineReplacementOperation,
	resolvePayload: InlinePayloadResolver,
): string | undefined {
	switch (operation.type) {
		case 'text-call': {
			const resolved = resolveInlinePath(operation.marker, operation.path, resolvePayload);
			return resolved ? JSON.stringify(resolved.value ?? `$locale.${operation.path}`) : undefined;
		}

		case 'localizer-call': {
			const resolved = resolveInlinePath(operation.marker, operation.path, resolvePayload);

			if (!resolved) {
				return undefined;
			}

			const payload = resolvePayload(decodeInlineLocaleMarker(operation.marker));
			const valuesExpression = replaceNestedInlineMarkerExpression(operation.valuesExpression, resolvePayload);

			if (typeof resolved.value === 'function') {
				const pluralExpression = operation.pluralExpression ? `, ${operation.pluralExpression}` : '';
				return `((${resolved.value.toString()})(${valuesExpression}${pluralExpression}))`;
			}

			const template = typeof resolved.value === 'string' ? resolved.value : `$locale.${operation.path}`;
			return createInlineTemplateExpression(template, valuesExpression, payload, resolved.scope);
		}

		case 'lookup-call': {
			const resolved = resolveInlinePath(operation.marker, operation.path, resolvePayload);

			if (!resolved || !isDictionary(resolved.value)) {
				return 'undefined';
			}

			return createInlineLookupExpression(
				resolved.value,
				operation.keyExpression,
				operation.suffixKeys,
				resolvePayload(decodeInlineLocaleMarker(operation.marker)),
				resolved.scope,
			);
		}

		case 'locale-object-call': {
			const payload = resolvePayload(decodeInlineLocaleMarker(operation.marker));
			const fallbackPayload = {
				env: createFallbackObject(payload.global, 'env'),
				sfc: createFallbackObject(payload.module, 'sfc'),
			};

			return createInlineRefAliasExpression(JSON.stringify(fallbackPayload));
		}

		case 'localizer-object-call': {
			const payload = resolvePayload(decodeInlineLocaleMarker(operation.marker));
			return createInlineRefAliasExpression(`{env:${createLocalizerObjectExpression(payload.global, payload, 'env')},sfc:${createLocalizerObjectExpression(payload.module, payload, 'sfc')}}`);
		}

		case 'localizer-binding-call': {
			const payload = resolvePayload(decodeInlineLocaleMarker(operation.marker));
			const normalized = normalizeInlineAccessPath(operation.properties);

			if (!normalized) {
				return undefined;
			}

			const value = getValueByPath(getPayloadScope(payload, normalized.scope), normalized.keys);
			const valuesExpression = replaceNestedInlineMarkerExpression(operation.valuesExpression, resolvePayload);

			if (typeof value === 'function') {
				const pluralExpression = operation.pluralExpression ? `, ${operation.pluralExpression}` : '';
				return `((${value.toString()})(${valuesExpression}${pluralExpression}))`;
			}

			const template = typeof value === 'string' ? value : `$locale.${[normalized.scope, ...normalized.keys].join('.')}`;
			return createInlineTemplateExpression(template, valuesExpression, payload, normalized.scope);
		}

		case 'locale-member': {
			const payload = resolvePayload(decodeInlineLocaleMarker(operation.marker));
			const normalized = normalizeInlineAccessPath(operation.properties);

			if (!normalized) {
				return undefined;
			}

			const value = getValueByPath(getPayloadScope(payload, normalized.scope), normalized.keys);
			return JSON.stringify(value ?? `$locale.${[normalized.scope, ...normalized.keys].join('.')}`);
		}
	}
}

function resolveInlinePath(
	marker: string,
	path: string,
	resolvePayload: InlinePayloadResolver,
): { scope: PublicLocaleScope; keys: string[]; value: unknown } | undefined {
	if (!isInlineLocaleMarker(marker)) {
		return undefined;
	}

	const [scope, ...keys] = path.split('.') as [PublicLocaleScope, ...string[]];

	if (!isPublicLocaleScope(scope) || keys.length === 0) {
		return undefined;
	}

	const payload = resolvePayload(decodeInlineLocaleMarker(marker));

	return {
		scope,
		keys,
		value: getValueByPath(getPayloadScope(payload, scope), keys),
	};
}

function readMemberAccess(node: AstNode): { root: string; properties: string[] } | undefined {
	if (isIdentifier(node)) {
		return {
			root: node.name,
			properties: [],
		};
	}

	if (!isMemberExpression(node) || node.computed || !isIdentifier(node.property)) {
		return undefined;
	}

	const parent = readMemberAccess(node.object);

	if (!parent) {
		return undefined;
	}

	return {
		root: parent.root,
		properties: [...parent.properties, node.property.name],
	};
}

function normalizeInlineAccessPath(properties: string[]): { scope: PublicLocaleScope; keys: string[] } | undefined {
	const path = properties[0] === 'value' ? properties.slice(1) : properties;
	const [scope, ...keys] = path;

	if (!isPublicLocaleScope(scope) || keys.length === 0) {
		return undefined;
	}

	return {
		scope,
		keys,
	};
}

function getStringArgument(node: AstCallExpression, index: number): string | undefined {
	const argument = node.arguments.at(index);

	if (!argument) {
		return undefined;
	}

	if (isLiteral(argument) && typeof argument.value === 'string') {
		return argument.value;
	}

	if (isTemplateLiteral(argument) && argument.expressions.length === 0) {
		return argument.quasis[0]?.value.cooked ?? argument.quasis[0]?.value.raw;
	}
}

function getCalleeName(callee: AstNode): string | undefined {
	if (isIdentifier(callee)) {
		return callee.name;
	}

	if (isMemberExpression(callee) && !callee.computed && isIdentifier(callee.property)) {
		return callee.property.name;
	}
}

function isCallCallee(node: AstNode, parent: AstNode | undefined): boolean {
	return parent?.type === 'CallExpression' && (parent as AstCallExpression).callee === node;
}

function isPublicLocaleScope(value: string | undefined): value is PublicLocaleScope {
	return value === 'env' || value === 'sfc';
}

function isInlineLocaleMarker(value: string): boolean {
	return value.startsWith(INLINE_MARKER_PREFIX);
}

function toAstNode(node: EstreeNode): AstNode | undefined {
	const maybeNode = node as Partial<AstNode>;

	return typeof maybeNode.start === 'number' && typeof maybeNode.end === 'number'
		? maybeNode as AstNode
		: undefined;
}

function isIdentifier(node: AstNode): node is AstIdentifier {
	return node.type === 'Identifier' && typeof node.name === 'string';
}

function isLiteral(node: AstNode): node is AstLiteral {
	return node.type === 'Literal';
}

function isTemplateLiteral(node: AstNode): node is AstTemplateLiteral {
	return node.type === 'TemplateLiteral';
}

function isMemberExpression(node: AstNode): node is AstMemberExpression {
	return node.type === 'MemberExpression';
}

function isCallExpression(node: AstNode): node is AstCallExpression {
	return node.type === 'CallExpression';
}

function isVariableDeclarator(node: AstNode): node is AstVariableDeclarator {
	return node.type === 'VariableDeclarator';
}

function createInlineTemplateExpression(
	template: string,
	valuesExpression: string,
	payload?: InlineLocalePayload,
	scope?: PublicLocaleScope,
	seen: Set<string> = new Set(),
): string {
	if (payload?.messageSyntax === 'icu') {
		return createInlineIcuMessageExpression(template, valuesExpression, payload.locale);
	}

	const cases = compileLocaleMessage(template).cases;
	const caseExpressions = cases.map((tokens) => createInlineTokenExpression(tokens, payload, scope, seen));

	if (cases.length > 1) {
		return `((__values) => { const __plural = typeof __values === "number" ? __values : Number(__values?.count ?? __values?.n ?? 1); const __index = ${createInlinePluralIndexExpression('Math.abs(Math.trunc(__plural))', cases.length)}; return [${caseExpressions.join(',')}][__index]; })(${valuesExpression})`;
	}

	if (caseExpressions.length === 1 && cases[0]?.length === 1 && cases[0][0]?.type === 'text') {
		return JSON.stringify(template);
	}

	return `((__values) => ${caseExpressions[0] ?? '""'})(${valuesExpression})`;
}

function createInlineIcuMessageExpression(
	template: string,
	valuesExpression: string,
	locale: string | undefined,
): string {
	const body = createInlineIcuElementsExpression(parseIcuMessage(template), '__values', JSON.stringify(locale));
	return `((__values) => ${body})(${valuesExpression})`;
}

function createInlineIcuElementsExpression(
	elements: MessageFormatElement[],
	valuesExpression: string,
	localeExpression: string,
	pluralValueExpression?: string,
): string {
	const parts = elements.map((element) => createInlineIcuElementExpression(element, valuesExpression, localeExpression, pluralValueExpression));
	return parts.length === 0 ? '""' : parts.join(' + ');
}

function createInlineIcuElementExpression(
	element: MessageFormatElement,
	valuesExpression: string,
	localeExpression: string,
	pluralValueExpression: string | undefined,
): string {
	switch (element.type) {
		case TYPE.literal:
			return JSON.stringify(element.value);
		case TYPE.argument:
		case TYPE.number:
		case TYPE.date:
		case TYPE.time:
			return `(${valuesExpression}?.[${JSON.stringify(element.value)}] ?? ${JSON.stringify(`{${element.value}}`)})`;
		case TYPE.pound:
			return `((${pluralValueExpression ?? 'undefined'}) ?? "#")`;
		case TYPE.select:
			return createInlineIcuSelectExpression(element, valuesExpression, localeExpression, pluralValueExpression);
		case TYPE.plural:
			return createInlineIcuPluralExpression(element, valuesExpression, localeExpression);
		case TYPE.tag:
			return createInlineIcuElementsExpression(element.children, valuesExpression, localeExpression, pluralValueExpression);
	}
}

function createInlineIcuSelectExpression(
	element: Extract<MessageFormatElement, { type: TYPE.select }>,
	valuesExpression: string,
	localeExpression: string,
	pluralValueExpression: string | undefined,
): string {
	const entries = Object.entries(element.options)
		.map(([key, option]) =>
			`${JSON.stringify(key)}:()=>${createInlineIcuElementsExpression(option.value, valuesExpression, localeExpression, pluralValueExpression)}`)
		.join(',');

	return `((__value)=>((({${entries}})[String(__value)] ?? ({${entries}}).other ?? (()=>${JSON.stringify(`{${element.value}}`)}))()))(${valuesExpression}?.[${JSON.stringify(element.value)}])`;
}

function createInlineIcuPluralExpression(
	element: Extract<MessageFormatElement, { type: TYPE.plural }>,
	valuesExpression: string,
	localeExpression: string,
): string {
	const choiceExpression = `Number(__value) - ${element.offset}`;
	const entries = Object.entries(element.options)
		.map(([key, option]) =>
			`${JSON.stringify(key)}:()=>${createInlineIcuElementsExpression(option.value, valuesExpression, localeExpression, choiceExpression)}`)
		.join(',');
	const exactEntries = Object.keys(element.options)
		.filter((key) => key.startsWith('='))
		.map((key) => `${JSON.stringify(key.slice(1))}:${JSON.stringify(key)}`)
		.join(',');

	return `((__value)=>{const __options={${entries}};const __exact=({${exactEntries}})[String(__value)];const __rule=__exact ?? new Intl.PluralRules(${localeExpression},{type:${JSON.stringify(element.pluralType)}}).select(${choiceExpression});return (__options[__rule] ?? __options.other ?? (()=>${JSON.stringify(`{${element.value}}`)}))();})(${valuesExpression}?.[${JSON.stringify(element.value)}])`;
}

function createInlineTokenExpression(
	tokens: ReturnType<typeof compileLocaleMessage>['cases'][number],
	payload: InlineLocalePayload | undefined,
	scope: PublicLocaleScope | undefined,
	seen: Set<string>,
): string {
	const parts = tokens.map((token) => {
		switch (token.type) {
			case 'text':
			case 'literal':
				return JSON.stringify(token.value);
			case 'named':
				return `((typeof __values === "number" ? (${token.key === 'count' || token.key === 'n' ? '__values' : 'undefined'}) : __values?.[${JSON.stringify(token.key)}]) ?? ${JSON.stringify(`{${token.key}}`)})`;
			case 'list':
				return `(Array.isArray(__values) && __values[${token.index}] != null ? __values[${token.index}] : ${JSON.stringify(`{${token.index}}`)})`;
			case 'linked':
				return createInlineLinkedExpression(token, payload, scope, seen);
		}
	});

	return parts.length === 0 ? '""' : parts.join(' + ');
}

function createInlinePluralIndexExpression(choiceExpression: string, choicesLength: number): string {
	const indexExpression = choicesLength === 2
		? `${choiceExpression} === 1 ? 0 : 1`
		: `${choiceExpression} === 0 ? 0 : ${choiceExpression} === 1 ? 1 : 2`;

	return `Math.min(${indexExpression}, ${choicesLength - 1})`;
}

function createInlineLinkedExpression(
	token: Extract<LocaleMessageToken, { type: 'linked' }>,
	payload: InlineLocalePayload | undefined,
	scope: PublicLocaleScope | undefined,
	seen: Set<string>,
): string {
	const resolved = payload && scope ? resolveInlineLinkedMessage(payload, token.key, scope, seen) : undefined;

	if (!resolved) {
		return JSON.stringify(`@:${token.key}`);
	}

	const expression = createInlineTemplateExpression(resolved.value, '__values', payload, resolved.scope, resolved.seen);

	if (!token.modifier) {
		return expression;
	}

	switch (token.modifier) {
		case 'upper':
			return `((${expression}).toLocaleUpperCase())`;
		case 'lower':
			return `((${expression}).toLocaleLowerCase())`;
		case 'capitalize':
			return `((__linked) => __linked.charAt(0).toLocaleUpperCase() + __linked.slice(1))(${expression})`;
		default:
			return expression;
	}
}

function resolveInlineLinkedMessage(
	payload: InlineLocalePayload,
	key: string,
	scope: PublicLocaleScope,
	seen: Set<string>,
): { scope: PublicLocaleScope; value: string; seen: Set<string> } | undefined {
	const path = resolveInlineLinkedPath(key, scope);
	const resolvedKey = path.join('.');

	if (seen.has(resolvedKey)) {
		return undefined;
	}

	const [resolvedScope, ...keys] = path;
	const value = getValueByPath(getPayloadScope(payload, resolvedScope), keys);

	if (typeof value !== 'string') {
		return undefined;
	}

	return {
		scope: resolvedScope,
		value,
		seen: new Set([...seen, resolvedKey]),
	};
}

function resolveInlineLinkedPath(key: string, scope: PublicLocaleScope): [PublicLocaleScope, ...string[]] {
	const [head = '', ...rest] = key.split('.');

	if (isPublicLocaleScope(head) && rest.length > 0) {
		return [head, ...rest];
	}

	return [scope, head, ...rest];
}

function createLocalizerObjectExpression(
	dictionary: LocaleDictionary,
	payload?: InlineLocalePayload,
	scope?: PublicLocaleScope,
): string {
	const entries = Object.entries(dictionary).map(([key, value]) => {
		const property = /^[$A-Z_a-z][$\w]*$/.test(key) ? key : JSON.stringify(key);
		const expression = isDictionary(value)
			? createLocalizerObjectExpression(value, payload, scope)
			: typeof value === 'function'
				? `(${value.toString()})`
				: `(values = {}) => ${createInlineTemplateExpression(typeof value === 'string' ? value : String(value), 'values', payload, scope)}`;

		return `${property}:${expression}`;
	});

	return `{${entries.join(',')}}`;
}

function createInlineRefAliasExpression(expression: string): string {
	return `(() => { const __locale = ${expression}; __locale.value = __locale; return __locale; })()`;
}

function toObjectPropertyName(key: string): string {
	return /^[$A-Z_a-z][$\w]*$/.test(key) ? key : JSON.stringify(key);
}

function getPayloadScope(payload: InlineLocalePayload, scope: PublicLocaleScope): LocaleDictionary {
	return scope === 'env' ? payload.global : payload.module;
}

function mergeWithPrimary(current: LocaleDictionary | undefined, primary: LocaleDictionary | undefined): LocaleDictionary {
	return deepMerge(primary ?? {}, current ?? {});
}

function deepMerge(fallback: LocaleDictionary, current: LocaleDictionary): LocaleDictionary {
	const merged: LocaleDictionary = { ...fallback };

	for (const [key, value] of Object.entries(current)) {
		const fallbackValue = fallback[key];
		merged[key] = isDictionary(value) && isDictionary(fallbackValue) ? deepMerge(fallbackValue, value) : value;
	}

	return merged;
}

function createFallbackObject(dictionary: LocaleDictionary, path: string): LocaleDictionary {
	const result: LocaleDictionary = {};

	for (const [key, value] of Object.entries(dictionary)) {
		result[key] = isDictionary(value) ? createFallbackObject(value, `${path}.${key}`) : value;
	}

	return new Proxy(result, {
		get(target, property) {
			if (typeof property !== 'string') {
				return Reflect.get(target, property);
			}

			if (Object.prototype.hasOwnProperty.call(target, property)) {
				return target[property];
			}

			return `$locale.${path}.${property}`;
		},
	});
}

function getValueByPath(value: LocaleDictionary, path: string[]): unknown {
	let current: unknown = value;

	for (const key of path) {
		if (current == null || typeof current !== 'object' || Array.isArray(current) || !(key in current)) {
			return undefined;
		}

		current = (current as Record<string, unknown>)[key];
	}

	return current;
}

function isDictionary(value: unknown): value is LocaleDictionary {
	return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isMutableOutputChunk(value: unknown): value is MutableOutputChunk {
	if (value == null || typeof value !== 'object') {
		return false;
	}

	const maybeChunk = value as Partial<MutableOutputChunk>;

	return (
		maybeChunk.type === 'chunk' &&
    typeof maybeChunk.fileName === 'string' &&
    typeof maybeChunk.code === 'string' &&
    Array.isArray(maybeChunk.imports) &&
    Array.isArray(maybeChunk.dynamicImports)
	);
}

function isMutableOutputAsset(value: unknown): value is MutableOutputAsset {
	if (value == null || typeof value !== 'object') {
		return false;
	}

	const maybeAsset = value as { type?: unknown; fileName?: unknown };

	return maybeAsset.type === 'asset' && typeof maybeAsset.fileName === 'string';
}

function replaceEntryScript(
	html: string,
	localeFiles: Record<string, string>,
	primaryLocale: string,
	base: string,
): string {
	return html.replace(createEntryScriptRegExp(localeFiles, primaryLocale, base), (_match, beforeSrc: string, afterSrc: string) => {
		const primaryFile = localeFiles[primaryLocale];
		const loaderFileName = createLocaleLoaderFileName(originalFileNameFromLocaleFile(primaryFile, primaryLocale));

		return `<script${createLoaderScriptAttributes(beforeSrc, afterSrc, loaderFileName, base)}></script>`;
	});
}

function findHtmlLocaleEntries(
	html: string,
	manifest: InlineChunkManifest,
	htmlFileName?: string,
	base = '/',
): InlineChunkManifest['entries'] {
	const scriptEntries = manifest.entries.filter((entry) => createEntryScriptRegExp(entry.locales, manifest.primaryLocale, base).test(html));

	return scriptEntries.length > 0 ? scriptEntries : findFallbackHtmlLocaleEntries(html, manifest, htmlFileName, base);
}

function findFallbackHtmlLocaleEntries(
	html: string,
	manifest: InlineChunkManifest,
	htmlFileName?: string,
	base = '/',
): InlineChunkManifest['entries'] {
	if (manifest.entries.some((entry) => createEntryScriptRegExp(entry.locales, manifest.primaryLocale, base).test(html))) {
		return [];
	}

	const htmlEntries = manifest.entries.filter(isHtmlEntry);

	if (!htmlFileName) {
		return htmlEntries;
	}

	const matchingEntries = htmlEntries.filter((entry) => matchesHtmlFileName(entry, htmlFileName));

	if (matchingEntries.length > 0) {
		return matchingEntries;
	}

	return htmlEntries.length === 1 ? htmlEntries : [];
}

function createEntryScriptRegExp(localeFiles: Record<string, string>, primaryLocale: string, base: string): RegExp {
	const primaryFile = localeFiles[primaryLocale];
	const candidates = new Set(
		[
			originalFileNameFromLocaleFile(primaryFile, primaryLocale),
			...Object.values(localeFiles),
		].flatMap((fileName) => createPublicPathCandidates(fileName, base)),
	);

	return new RegExp(
		`<script\\b([^>]*?)\\bsrc=["'](?:${[...candidates].map(escapeRegExp).join('|')})["']([^>]*)></script>`,
		'u',
	);
}

function createLocaleLoaderFileName(originalFileName: string): string {
	return originalFileName.replace(/(\.m?js)$/u, '.i18n-loader$1');
}

function createLocaleLoaderSource(localeFiles: Record<string, string>, primaryLocale: string, base: string): string {
	return [
		`const __vueInternationalizationLocale = new URL(window.location.href).searchParams.get("locale") || ${JSON.stringify(primaryLocale)};`,
		`const __vueInternationalizationEntries = ${JSON.stringify(toPublicLocaleFiles(localeFiles, base))};`,
		`import(__vueInternationalizationEntries[__vueInternationalizationLocale] || __vueInternationalizationEntries[${JSON.stringify(primaryLocale)}]);`,
		'',
	].join('\n');
}

function createLoaderScriptAttributes(beforeSrc: string, afterSrc: string, loaderFileName: string, base: string): string {
	const attributes = removeScriptAttribute(`${beforeSrc}${afterSrc}`, 'src');
	const withoutIntegrity = removeScriptAttribute(attributes, 'integrity');
	const typeAttribute = hasScriptAttribute(withoutIntegrity, 'type') ? '' : ' type="module"';

	return `${withoutIntegrity}${typeAttribute} src="${toPublicPath(loaderFileName, base)}"`;
}

function injectLocaleLoaderScript(
	html: string,
	entry: InlineChunkManifest['entries'][number],
	primaryLocale: string,
	base: string,
): string {
	const primaryFile = entry.locales[primaryLocale];
	const loaderFileName = createLocaleLoaderFileName(originalFileNameFromLocaleFile(primaryFile, primaryLocale));
	const cssLinks = (entry.css ?? [])
		.map((fileName) => `<link rel="stylesheet" href="${toPublicPath(fileName, base)}">`)
		.join('');
	const loaderPath = toPublicPath(loaderFileName, base);
	const script = `<script type="module" src="${loaderPath}"></script>`;
	const injection = `${cssLinks}${script}`;

	if (html.includes(`src="${loaderPath}"`) || html.includes(`src='${loaderPath}'`)) {
		return html;
	}

	if (/<\/body>/iu.test(html)) {
		return html.replace(/<\/body>/iu, `${injection}</body>`);
	}

	return `${html}${injection}`;
}

function isHtmlEntry(entry: InlineChunkManifest['entries'][number]): boolean {
	return entry.isEntry === true && entry.isDynamicEntry !== true;
}

function matchesHtmlFileName(entry: InlineChunkManifest['entries'][number], htmlFileName: string): boolean {
	return typeof entry.facadeModuleId === 'string' &&
		normalizePath(entry.facadeModuleId).endsWith(normalizePath(htmlFileName));
}

function removeScriptAttribute(attributes: string, name: string): string {
	return attributes.replace(new RegExp(`\\s+${escapeRegExp(name)}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'giu'), '');
}

function hasScriptAttribute(attributes: string, name: string): boolean {
	return new RegExp(`(?:^|\\s)${escapeRegExp(name)}(?:\\s*=|\\s|$)`, 'iu').test(attributes);
}

function toPublicLocaleFiles(localeFiles: Record<string, string>, base: string): Record<string, string> {
	return Object.fromEntries(Object.entries(localeFiles).map(([locale, fileName]) => [locale, toPublicPath(fileName, base)]));
}

function toPublicPath(fileName: string, base: string): string {
	if (/^[a-z][a-z\d+\-.]*:/iu.test(base) || base.startsWith('//')) {
		return new URL(fileName, base).toString();
	}

	if (base === '' || base === './') {
		return `${base}${fileName}`;
	}

	return `${base.endsWith('/') ? base : `${base}/`}${fileName}`;
}

function createPublicPathCandidates(fileName: string, base: string): string[] {
	const publicPath = toPublicPath(fileName, base);
	const candidates = new Set([publicPath]);

	if (base === '' || base === './') {
		candidates.add(fileName);
		candidates.add(`./${fileName}`);
	}

	return [...candidates];
}

function findManifestEntry(
	manifest: Record<string, Record<string, unknown>>,
	entry: InlineChunkManifest['entries'][number],
): [string, Record<string, unknown>] | undefined {
	const fileNames = new Set([entry.originalFileName, ...Object.values(entry.locales)]);
	const fileNameMatch = Object.entries(manifest).find(([, value]) =>
		typeof value.file === 'string' && fileNames.has(value.file),
	);

	if (fileNameMatch) {
		return fileNameMatch;
	}

	if (!entry.facadeModuleId) {
		return undefined;
	}

	const normalizedFacadeModuleId = entry.facadeModuleId.replace(/\\/gu, '/');

	return Object.entries(manifest).find(([key, value]) =>
		typeof value.src === 'string' &&
		(value.src === key || key.endsWith(value.src)) &&
		normalizedFacadeModuleId.endsWith(key.replace(/\\/gu, '/')),
	);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function normalizePath(value: string): string {
	return value.replace(/\\/g, '/');
}

function decodeInlineLocaleMarker(marker: string): string {
	if (!marker.startsWith(INLINE_MARKER_PREFIX)) {
		throw new Error(`Invalid inline locale marker: ${marker}`);
	}

	return Buffer.from(marker.slice(INLINE_MARKER_PREFIX.length), 'base64').toString('utf8');
}

function sanitizeLocale(locale: string): string {
	return locale.replace(/[^A-Za-z0-9_-]/gu, '-');
}

function baseName(fileName: string): string {
	return fileName.split('/').at(-1) ?? fileName;
}

function originalFileNameFromLocaleFile(fileName: string, locale: string): string {
	return fileName.replace(new RegExp(`\\.${escapeRegExp(sanitizeLocale(locale))}(\\.m?js)$`, 'u'), '$1');
}
