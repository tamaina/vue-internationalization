import type { LocaleDictionary, LocaleValue } from './types.js';

export type LocaleBindingTypes = {
	primaryLocale?: string;
	global?: LocaleDictionary;
	module?: LocaleDictionary;
};

export function createUseLocaleTypeParameters(types: LocaleBindingTypes): string {
	if (!types.global && !types.module) {
		return '';
	}

	return `<${toTypeLiteral(types.global ?? {})}, ${toTypeLiteral(types.module ?? {})}>`;
}

export function createLocaleScopeType(types: LocaleBindingTypes): string {
	return `import("vue-internationalization/runtime").LocaleScope<${toTypeLiteral(types.global ?? {})}, ${toTypeLiteral(types.module ?? {})}>`;
}

export function createLocaleRefType(types: LocaleBindingTypes): string {
	return `Readonly<import("vue").ComputedRef<${createLocaleScopeType(types)}>>`;
}

export function createLocaleConstScopeType(types: LocaleBindingTypes): string {
	return `import("vue-internationalization/runtime").LocaleScope<${toConstTypeLiteral(types.global ?? {})}, ${toConstTypeLiteral(types.module ?? {})}>`;
}

export function createLocaleConstRefType(types: LocaleBindingTypes): string {
	return `Readonly<import("vue").ComputedRef<${createLocaleConstScopeType(types)}>>`;
}

export function createLocalizerScopeType(types: LocaleBindingTypes): string {
	return `{ env: ${toLocalizerTypeLiteral(types.global ?? {})}; sfc: ${toLocalizerTypeLiteral(types.module ?? {})}; }`;
}

export function createLocalizerRefType(types: LocaleBindingTypes): string {
	return `Readonly<import("vue").ComputedRef<${createLocalizerScopeType(types)}>>`;
}

export function createLocalizerDocumentationScopeType(types: LocaleBindingTypes): string {
	return `{ env: ${toLocalizerDocumentationTypeLiteral(types.global ?? {}, ['env'])}; sfc: ${toLocalizerDocumentationTypeLiteral(types.module ?? {}, ['sfc'])}; }`;
}

export function createLocalizerDocumentationRefType(types: LocaleBindingTypes): string {
	return `Readonly<import("vue").ComputedRef<${createLocalizerDocumentationScopeType(types)}>>`;
}

export function toTypeLiteral(dictionary: LocaleDictionary): string {
	const entries = Object.entries(dictionary).map(([key, value]) => `${toPropertyName(key)}: ${toType(value)};`);
	return entries.length === 0 ? '{}' : `{ ${entries.join(' ')} }`;
}

function toType(value: LocaleValue): string {
	if (typeof value === 'string') {
		return 'string';
	}

	if (typeof value === 'number') {
		return 'number';
	}

	if (typeof value === 'boolean') {
		return 'boolean';
	}

	if (value === null) {
		return 'null';
	}

	if (Array.isArray(value)) {
		const itemTypes = [...new Set(value.map((item) => toType(item)))];
		return itemTypes.length === 0 ? 'unknown[]' : `Array<${itemTypes.join(' | ')}>`;
	}

	return toTypeLiteral(value);
}

function toConstTypeLiteral(dictionary: LocaleDictionary): string {
	const entries = Object.entries(dictionary).map(([key, value]) => `${toPropertyName(key)}: ${toConstType(value)};`);
	return entries.length === 0 ? '{}' : `{ ${entries.join(' ')} }`;
}

function toConstType(value: LocaleValue): string {
	if (typeof value === 'string') {
		return JSON.stringify(value);
	}

	if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
		return JSON.stringify(value);
	}

	if (Array.isArray(value)) {
		const itemTypes = [...new Set(value.map((item) => toConstType(item)))];
		return itemTypes.length === 0 ? 'unknown[]' : `Array<${itemTypes.join(' | ')}>`;
	}

	return toConstTypeLiteral(value);
}

function toLocalizerTypeLiteral(dictionary: LocaleDictionary): string {
	const entries = Object.entries(dictionary).map(([key, value]) => `${toPropertyName(key)}: ${toLocalizerType(value)};`);
	return entries.length === 0 ? 'import("vue-internationalization/runtime").LocaleLocalizerDictionary' : `{ ${entries.join(' ')} }`;
}

function toLocalizerType(value: LocaleValue): string {
	if (value != null && typeof value === 'object' && !Array.isArray(value)) {
		return toLocalizerTypeLiteral(value);
	}

	return toLocaleTemplateFunctionType(value);
}

function toLocalizerDocumentationTypeLiteral(dictionary: LocaleDictionary, path: string[]): string {
	const entries = Object.entries(dictionary).map(([key, value]) => {
		const currentPath = [...path, key];
		const documentation = typeof value === 'string' ? toDocumentation(value, currentPath) : '';
		return `${documentation}${toPropertyName(key)}: ${toLocalizerDocumentationType(value, currentPath)};`;
	});

	return entries.length === 0 ? 'import("vue-internationalization/runtime").LocaleLocalizerDictionary' : `{\n${entries.join('\n')}\n}`;
}

function toLocalizerDocumentationType(value: LocaleValue, path: string[]): string {
	if (value != null && typeof value === 'object' && !Array.isArray(value)) {
		return toLocalizerDocumentationTypeLiteral(value, path);
	}

	return toLocaleTemplateFunctionType(value);
}

function toDocumentation(value: string, path: string[]): string {
	const example = `${toLocalizerAccessPath(path)}(${toLocalizerExampleArguments(value)})`;
	const lines = [
		'Primary locale text:',
		...value.replaceAll('*/', '*\\/').split(/\r\n|\r|\n/u),
		'',
		'@example',
		example,
	];

	return `/**\n${lines.map((line) => ` * ${line}`).join('\n')}\n */\n`;
}

function toLocalizerExampleArguments(value: string): string {
	const keys = getLocaleTemplateKeys(value);
	return keys.length === 0 ? '' : `{ ${keys.join(', ')} }`;
}

function toLocaleTemplateFunctionType(value: LocaleValue): string {
	const keys = typeof value === 'string' ? getLocaleTemplateKeys(value) : [];

	if (keys.length === 0) {
		return '() => string';
	}

	return `(values: { ${keys.map((key) => `${toPropertyName(key)}: import("vue-internationalization/runtime").LocaleTemplateValue;`).join(' ')} }) => string`;
}

function getLocaleTemplateKeys(value: string): string[] {
	return [...new Set([...value.matchAll(/\{([A-Za-z_$][\w$]*)\}/g)].map((match) => match[1]))];
}

function toLocalizerAccessPath(path: string[]): string {
	return path.reduce((current, key) => `${current}${toAccessPathSegment(key)}`, '$l');
}

function toAccessPathSegment(key: string): string {
	return /^[$A-Z_a-z][$\w]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

function toPropertyName(key: string): string {
	return /^[$A-Z_a-z][$\w]*$/.test(key) ? key : JSON.stringify(key);
}
