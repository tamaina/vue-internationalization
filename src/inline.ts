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
		locales: Record<string, string>;
	}>;
};

export type InlineLocaleLoaderAsset = {
	fileName: string;
	source: string;
};

type ModuleMessages = Partial<Record<string, Partial<Record<string, LocaleDictionary>>>>;
type LocaleMessages = Partial<Record<string, LocaleDictionary>>;
type PublicLocaleScope = 'env' | 'sfc';
type InlinePayloadResolver = (moduleId: string) => InlineLocalePayload;
type AstReplaceOptions = {
	localeMembers?: boolean;
	localizerCalls?: boolean;
	textCalls?: boolean;
	objectCalls?: boolean;
	allowMarkerFallback?: boolean;
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

const INLINE_MARKER_PREFIX = '__VUE_INTERNATIONALIZATION_INLINE__:';
const INLINE_LOCALE_CALL = '__VUE_INTERNATIONALIZATION_INLINE_LOCALE__';
const INLINE_LOCALIZERS_CALL = '__VUE_INTERNATIONALIZATION_INLINE_LOCALIZERS__';
const INLINE_TEXT_CALL = '__VUE_INTERNATIONALIZATION_INLINE_TEXT__';
const INLINE_LOCALIZER_CALL = '__VUE_INTERNATIONALIZATION_INLINE_LOCALIZER__';
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
		rewriteTemplateLocalizerAccess(template, marker)
			.replace(LOCALE_ACCESS_RE, (_match, scope: PublicLocaleScope, pathExpression: string) =>
				`__VUE_INTERNATIONALIZATION_INLINE_TEXT__(${createTemplateStringArgument(marker)},${createTemplateStringArgument(`${scope}${pathExpression}`)})`,
			),
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
	const localizableChunks = Object.values(bundle)
		.filter((chunk): chunk is MutableOutputChunk => isMutableOutputChunk(chunk) && chunk.code.includes(INLINE_MARKER_PREFIX))
		.map((chunk) => ({
			chunk,
			originalCode: chunk.code,
			parsed: parseRequiredInlineJavaScript(chunk.code),
			originalFileName: chunk.fileName,
			originalImports: [...chunk.imports],
			originalDynamicImports: [...chunk.dynamicImports],
		}));
	const localizableFiles = new Set(localizableChunks.map(({ originalFileName }) => originalFileName));

	for (const { chunk, originalCode, parsed, originalFileName, originalImports, originalDynamicImports } of localizableChunks) {
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
			localizedChunk.imports = originalImports.map((fileName) => addLocaleToImportedFileName(localizableFiles, fileName, locale));
			localizedChunk.dynamicImports = originalDynamicImports.map((fileName) =>
				addLocaleToImportedFileName(localizableFiles, fileName, locale),
			);
			localizedChunk.code = replaceChunkFileReferences(
				replaceInlineLocaleMarkers(originalCode, locale, primaryLocale, messageSyntax, modules, globalMessages, parsed),
				getLocalizableChunkReferences(originalImports, originalDynamicImports, localizableFiles),
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
			locales: localeFiles,
		});
	}

	return manifest;
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
	options: {
		emitAsset?: InlineLocaleAssetEmitter;
	} = {},
): void {
	for (const asset of Object.values(bundle)) {
		if (!isMutableOutputAsset(asset) || typeof asset.source !== 'string' || !asset.fileName.endsWith('.html')) {
			continue;
		}

		for (const loader of getInlineLocaleHtmlLoaders(asset.source, manifest)) {
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

		asset.source = replaceInlineLocaleHtml(asset.source, manifest);
	}
}

export function getInlineLocaleHtmlLoaders(html: string, manifest: InlineChunkManifest): InlineLocaleLoaderAsset[] {
	return findHtmlLocaleEntries(html, manifest).map((entry) => ({
		fileName: createLocaleLoaderFileName(entry.originalFileName),
		source: createLocaleLoaderSource(entry.locales, manifest.primaryLocale),
	}));
}

export function replaceInlineLocaleHtml(html: string, manifest: InlineChunkManifest): string {
	let next = html;

	for (const entry of manifest.entries) {
		next = replaceEntryScript(next, entry.locales, manifest.primaryLocale);
	}

	return next;
}

export function augmentViteManifestJson(source: string, inlineManifest: InlineChunkManifest): string {
	const manifest = JSON.parse(source) as Record<string, Record<string, unknown>>;

	for (const entry of inlineManifest.entries) {
		const manifestEntry = findManifestEntry(manifest, Object.values(entry.locales));

		if (!manifestEntry) {
			continue;
		}

		const [key, value] = manifestEntry;
		value.file = entry.locales[inlineManifest.primaryLocale];
		value.locale = inlineManifest.primaryLocale;
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

export function addLocaleToFileName(fileName: string, locale: string): string {
	return fileName.replace(/(\.m?js)$/u, `.${sanitizeLocale(locale)}$1`);
}

function addLocaleToImportedFileName(localizableFiles: Set<string>, fileName: string, locale: string): string {
	if (localizableFiles.has(fileName)) {
		return addLocaleToFileName(fileName, locale);
	}

	return fileName;
}

function getLocalizableChunkReferences(
	imports: string[],
	dynamicImports: string[],
	localizableFiles: Set<string>,
): Set<string> {
	return new Set(
		[...imports, ...dynamicImports]
			.filter((fileName) => localizableFiles.has(fileName)),
	);
}

function replaceChunkFileReferences(code: string, localizableFiles: Set<string>, locale: string): string {
	let next = code;

	for (const fileName of localizableFiles) {
		const localizedFileName = addLocaleToFileName(fileName, locale);

		next = next.replaceAll(fileName, localizedFileName);
		next = next.replaceAll(baseName(fileName), baseName(localizedFileName));
	}

	return next;
}

function createInlinePayloadResolver(
	locale: string,
	primaryLocale: string,
	messageSyntax: LocaleMessageSyntax,
	modules: ModuleMessages,
	globalMessages: LocaleMessages,
): InlinePayloadResolver {
	const global = mergeWithPrimary(globalMessages[locale], globalMessages[primaryLocale]);
	const modulesById = new Map<string, LocaleDictionary>();

	return (moduleId) => {
		let module = modulesById.get(moduleId);

		if (!module) {
			module = mergeWithPrimary(modules[moduleId]?.[locale], modules[moduleId]?.[primaryLocale]);
			modulesById.set(moduleId, module);
		}

		return {
			locale,
			messageSyntax,
			global,
			module,
		};
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

	const localeBindings = new Map<string, InlineLocalePayload>();
	const localizerBindings = new Map<string, InlineLocalePayload>();
	const magic = new MagicString(code);

	walk(parsedCode.ast as unknown as EstreeNode, {
		enter(node, parent) {
			const current = toAstNode(node);
			const currentParent = parent ? toAstNode(parent) : undefined;

			if (!current) {
				return;
			}

			if (isVariableDeclarator(current)) {
				collectInlineBinding(current, resolvePayload, localeBindings, localizerBindings);
				return;
			}

			if (isCallExpression(current)) {
				const replacement = getCallReplacement(code, current, resolvePayload, localizerBindings, options);

				if (replacement !== undefined) {
					magic.overwrite(current.start, current.end, replacement);
					this.skip();
				}

				return;
			}

			if (
				options.localeMembers === true &&
				isMemberExpression(current) &&
				!isCallCallee(current, currentParent)
			) {
				const replacement = getLocaleMemberReplacement(current, localeBindings);

				if (replacement !== undefined) {
					magic.overwrite(current.start, current.end, replacement);
					this.skip();
				}
			}
		},
	});

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

function collectInlineBinding(
	node: AstVariableDeclarator,
	resolvePayload: InlinePayloadResolver,
	localeBindings: Map<string, InlineLocalePayload>,
	localizerBindings: Map<string, InlineLocalePayload>,
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
		localeBindings.set(node.id.name, resolvePayload(decodeInlineLocaleMarker(marker)));
		return;
	}

	if (calleeName === INLINE_LOCALIZERS_CALL) {
		localizerBindings.set(node.id.name, resolvePayload(decodeInlineLocaleMarker(marker)));
	}
}

function getCallReplacement(
	code: string,
	node: AstCallExpression,
	resolvePayload: InlinePayloadResolver,
	localizerBindings: Map<string, InlineLocalePayload>,
	options: AstReplaceOptions,
): string | undefined {
	const calleeName = getCalleeName(node.callee);

	if (options.textCalls === true && calleeName === INLINE_TEXT_CALL) {
		return getInlineTextCallReplacement(node, resolvePayload);
	}

	if (options.localizerCalls === true && calleeName === INLINE_LOCALIZER_CALL) {
		return getInlineLocalizerCallReplacement(code, node, resolvePayload);
	}

	if (options.objectCalls === true && calleeName === INLINE_LOCALE_CALL) {
		return getInlineLocaleObjectReplacement(node, resolvePayload);
	}

	if (options.objectCalls === true && calleeName === INLINE_LOCALIZERS_CALL) {
		return getInlineLocalizerObjectReplacement(node, resolvePayload);
	}

	if (options.localizerCalls === true) {
		return getLocalizerBindingCallReplacement(code, node, localizerBindings);
	}
}

function getInlineTextCallReplacement(node: AstCallExpression, resolvePayload: InlinePayloadResolver): string | undefined {
	const marker = getStringArgument(node, 0);
	const path = getStringArgument(node, 1);

	if (!marker || !isInlineLocaleMarker(marker) || !path) {
		return undefined;
	}

	const resolved = resolveInlinePath(marker, path, resolvePayload);

	if (!resolved) {
		return undefined;
	}

	return JSON.stringify(resolved.value ?? `$locale.${path}`);
}

function getInlineLocalizerCallReplacement(
	code: string,
	node: AstCallExpression,
	resolvePayload: InlinePayloadResolver,
): string | undefined {
	const marker = getStringArgument(node, 0);
	const path = getStringArgument(node, 1);
	const values = node.arguments.at(2);

	if (!marker || !isInlineLocaleMarker(marker) || !path) {
		return undefined;
	}

	const resolved = resolveInlinePath(marker, path, resolvePayload);

	if (!resolved) {
		return undefined;
	}

	if (typeof resolved.value === 'function') {
		const valuesExpression = values ? replaceNestedInlineMarkerExpression(code.slice(values.start, values.end), resolvePayload) : '{}';
		const plural = node.arguments.at(3);
		const pluralExpression = plural ? `, ${code.slice(plural.start, plural.end)}` : '';
		return `((${resolved.value.toString()})(${valuesExpression}${pluralExpression}))`;
	}

	const template = typeof resolved.value === 'string' ? resolved.value : `$locale.${path}`;
	const valuesExpression = values ? replaceNestedInlineMarkerExpression(code.slice(values.start, values.end), resolvePayload) : '{}';
	return createInlineTemplateExpression(template, valuesExpression, resolvePayload(decodeInlineLocaleMarker(marker)), resolved.scope);
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

function getInlineLocaleObjectReplacement(node: AstCallExpression, resolvePayload: InlinePayloadResolver): string | undefined {
	const marker = getStringArgument(node, 0);

	if (!marker || !isInlineLocaleMarker(marker)) {
		return undefined;
	}

	const payload = resolvePayload(decodeInlineLocaleMarker(marker));
	const fallbackPayload = {
		env: createFallbackObject(payload.global, 'env'),
		sfc: createFallbackObject(payload.module, 'sfc'),
	};

	return createInlineRefAliasExpression(JSON.stringify(fallbackPayload));
}

function getInlineLocalizerObjectReplacement(node: AstCallExpression, resolvePayload: InlinePayloadResolver): string | undefined {
	const marker = getStringArgument(node, 0);

	if (!marker || !isInlineLocaleMarker(marker)) {
		return undefined;
	}

	const payload = resolvePayload(decodeInlineLocaleMarker(marker));
	return createInlineRefAliasExpression(`{env:${createLocalizerObjectExpression(payload.global, payload, 'env')},sfc:${createLocalizerObjectExpression(payload.module, payload, 'sfc')}}`);
}

function getLocalizerBindingCallReplacement(
	code: string,
	node: AstCallExpression,
	localizerBindings: Map<string, InlineLocalePayload>,
): string | undefined {
	const access = readMemberAccess(node.callee);
	const values = node.arguments.at(0);

	if (!access) {
		return undefined;
	}

	const payload = localizerBindings.get(access.root);

	if (!payload) {
		return undefined;
	}

	const normalized = normalizeInlineAccessPath(access.properties);

	if (!normalized) {
		return undefined;
	}

	const value = getValueByPath(getPayloadScope(payload, normalized.scope), normalized.keys);
	if (typeof value === 'function') {
		const valuesExpression = values ? code.slice(values.start, values.end) : '{}';
		const plural = node.arguments.at(1);
		const pluralExpression = plural ? `, ${code.slice(plural.start, plural.end)}` : '';
		return `((${value.toString()})(${valuesExpression}${pluralExpression}))`;
	}

	const template = typeof value === 'string' ? value : `$locale.${[normalized.scope, ...normalized.keys].join('.')}`;

	return createInlineTemplateExpression(template, values ? code.slice(values.start, values.end) : '{}', payload, normalized.scope);
}

function getLocaleMemberReplacement(
	node: AstMemberExpression,
	localeBindings: Map<string, InlineLocalePayload>,
): string | undefined {
	const access = readMemberAccess(node);

	if (!access) {
		return undefined;
	}

	const payload = localeBindings.get(access.root);

	if (!payload) {
		return undefined;
	}

	const normalized = normalizeInlineAccessPath(access.properties);

	if (!normalized) {
		return undefined;
	}

	const value = getValueByPath(getPayloadScope(payload, normalized.scope), normalized.keys);

	return JSON.stringify(value ?? `$locale.${[normalized.scope, ...normalized.keys].join('.')}`);
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

function replaceEntryScript(html: string, localeFiles: Record<string, string>, primaryLocale: string): string {
	return html.replace(createEntryScriptRegExp(localeFiles, primaryLocale), (_match, beforeSrc: string, afterSrc: string) => {
		const primaryFile = localeFiles[primaryLocale];
		const loaderFileName = createLocaleLoaderFileName(originalFileNameFromLocaleFile(primaryFile, primaryLocale));

		return `<script${createLoaderScriptAttributes(beforeSrc, afterSrc, loaderFileName)}></script>`;
	});
}

function findHtmlLocaleEntries(html: string, manifest: InlineChunkManifest): InlineChunkManifest['entries'] {
	return manifest.entries.filter((entry) => createEntryScriptRegExp(entry.locales, manifest.primaryLocale).test(html));
}

function createEntryScriptRegExp(localeFiles: Record<string, string>, primaryLocale: string): RegExp {
	const primaryFile = localeFiles[primaryLocale];
	const candidates = new Set([
		originalFileNameFromLocaleFile(primaryFile, primaryLocale),
		...Object.values(localeFiles),
	]);

	return new RegExp(
		`<script\\b([^>]*?)\\bsrc=["']/(?:${[...candidates].map(escapeRegExp).join('|')})["']([^>]*)></script>`,
		'u',
	);
}

function createLocaleLoaderFileName(originalFileName: string): string {
	return originalFileName.replace(/(\.m?js)$/u, '.i18n-loader$1');
}

function createLocaleLoaderSource(localeFiles: Record<string, string>, primaryLocale: string): string {
	return [
		`const __vueInternationalizationLocale = new URL(window.location.href).searchParams.get("locale") || ${JSON.stringify(primaryLocale)};`,
		`const __vueInternationalizationEntries = ${JSON.stringify(toAbsoluteLocaleFiles(localeFiles))};`,
		`import(__vueInternationalizationEntries[__vueInternationalizationLocale] || __vueInternationalizationEntries[${JSON.stringify(primaryLocale)}]);`,
		'',
	].join('\n');
}

function createLoaderScriptAttributes(beforeSrc: string, afterSrc: string, loaderFileName: string): string {
	const attributes = removeScriptAttribute(`${beforeSrc}${afterSrc}`, 'src');
	const withoutIntegrity = removeScriptAttribute(attributes, 'integrity');
	const typeAttribute = hasScriptAttribute(withoutIntegrity, 'type') ? '' : ' type="module"';

	return `${withoutIntegrity}${typeAttribute} src="/${loaderFileName}"`;
}

function removeScriptAttribute(attributes: string, name: string): string {
	return attributes.replace(new RegExp(`\\s+${escapeRegExp(name)}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'giu'), '');
}

function hasScriptAttribute(attributes: string, name: string): boolean {
	return new RegExp(`(?:^|\\s)${escapeRegExp(name)}(?:\\s*=|\\s|$)`, 'iu').test(attributes);
}

function toAbsoluteLocaleFiles(localeFiles: Record<string, string>): Record<string, string> {
	return Object.fromEntries(Object.entries(localeFiles).map(([locale, fileName]) => [locale, `/${fileName}`]));
}

function findManifestEntry(
	manifest: Record<string, Record<string, unknown>>,
	fileNames: string[],
): [string, Record<string, unknown>] | undefined {
	return Object.entries(manifest).find(([, value]) => typeof value.file === 'string' && fileNames.includes(value.file));
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
