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

export function createLocalizerScopeType(types: LocaleBindingTypes): string {
	return `{ global: ${toLocalizerTypeLiteral(types.global ?? {})}; module: ${toLocalizerTypeLiteral(types.module ?? {})}; }`;
}

export function createLocalizerRefType(types: LocaleBindingTypes): string {
	return `Readonly<import("vue").ComputedRef<${createLocalizerScopeType(types)}>>`;
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

function toLocalizerTypeLiteral(dictionary: LocaleDictionary): string {
	const entries = Object.entries(dictionary).map(([key, value]) => `${toPropertyName(key)}: ${toLocalizerType(value)};`);
	return entries.length === 0 ? 'import("vue-internationalization/runtime").LocaleLocalizerDictionary' : `{ ${entries.join(' ')} }`;
}

function toLocalizerType(value: LocaleValue): string {
	if (value != null && typeof value === 'object' && !Array.isArray(value)) {
		return toLocalizerTypeLiteral(value);
	}

	return 'import("vue-internationalization/runtime").LocaleTemplateFunction';
}

function toPropertyName(key: string): string {
	return /^[$A-Z_a-z][$\w]*$/.test(key) ? key : JSON.stringify(key);
}
