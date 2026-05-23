import { getLocaleMessageListIndexes, getLocaleMessageNamedKeys, hasLocaleMessagePlural } from './message.js';
import type { LocaleMessageSyntax } from './message.js';
import type { LocaleDictionary, LocaleValue } from './types.js';

export type LocaleBindingTypes = {
	primaryLocale?: string;
	global?: LocaleDictionary;
	module?: LocaleDictionary;
	messageSyntax?: LocaleMessageSyntax;
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
	return `{ env: ${toLocalizerTypeLiteral(types.global ?? {}, types.messageSyntax ?? 'vue')}; sfc: ${toLocalizerTypeLiteral(types.module ?? {}, types.messageSyntax ?? 'vue')}; }`;
}

export function createLocalizerRefType(types: LocaleBindingTypes): string {
	return `Readonly<import("vue").ComputedRef<${createLocalizerScopeType(types)}>>`;
}

export function createLocalizerDocumentationScopeType(types: LocaleBindingTypes): string {
	return `{ env: ${toLocalizerDocumentationTypeLiteral(types.global ?? {}, ['env'], types.messageSyntax ?? 'vue')}; sfc: ${toLocalizerDocumentationTypeLiteral(types.module ?? {}, ['sfc'], types.messageSyntax ?? 'vue')}; }`;
}

export function createLocalizerDocumentationRefType(types: LocaleBindingTypes): string {
	return `Readonly<import("vue").ComputedRef<${createLocalizerDocumentationScopeType(types)}>>`;
}

export function toTypeLiteral(dictionary: LocaleDictionary): string {
	const entries = Object.entries(dictionary).map(([key, value]) => `${toPropertyName(key)}: ${toType(value)};`);
	return entries.length === 0 ? '{}' : `{ ${entries.join(' ')} }`;
}

function toType(value: LocaleValue): string {
	if (typeof value === 'function') {
		return 'import("vue-internationalization/runtime").LocaleMessageFunction';
	}

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
	if (typeof value === 'function') {
		return 'import("vue-internationalization/runtime").LocaleMessageFunction';
	}

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

function toLocalizerTypeLiteral(dictionary: LocaleDictionary, messageSyntax: LocaleMessageSyntax): string {
	const entries = Object.entries(dictionary).map(([key, value]) => `${toPropertyName(key)}: ${toLocalizerType(value, messageSyntax)};`);
	return entries.length === 0 ? 'import("vue-internationalization/runtime").LocaleLocalizerDictionary' : `{ ${entries.join(' ')} }`;
}

function toLocalizerType(value: LocaleValue, messageSyntax: LocaleMessageSyntax): string {
	if (value != null && typeof value === 'object' && !Array.isArray(value)) {
		return toLocalizerTypeLiteral(value, messageSyntax);
	}

	if (typeof value === 'function') {
		return 'import("vue-internationalization/runtime").LocaleMessageFunction';
	}

	return toLocaleTemplateFunctionType(value, messageSyntax);
}

function toLocalizerDocumentationTypeLiteral(dictionary: LocaleDictionary, path: string[], messageSyntax: LocaleMessageSyntax): string {
	const entries = Object.entries(dictionary).map(([key, value]) => {
		const currentPath = [...path, key];
		const documentation = typeof value === 'string' ? toDocumentation(value, currentPath) : '';
		return `${documentation}${toPropertyName(key)}: ${toLocalizerDocumentationType(value, currentPath, messageSyntax)};`;
	});

	return entries.length === 0 ? 'import("vue-internationalization/runtime").LocaleLocalizerDictionary' : `{\n${entries.join('\n')}\n}`;
}

function toLocalizerDocumentationType(value: LocaleValue, path: string[], messageSyntax: LocaleMessageSyntax): string {
	if (value != null && typeof value === 'object' && !Array.isArray(value)) {
		return toLocalizerDocumentationTypeLiteral(value, path, messageSyntax);
	}

	if (typeof value === 'function') {
		return 'import("vue-internationalization/runtime").LocaleMessageFunction';
	}

	return toLocaleTemplateFunctionType(value, messageSyntax);
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
	const keys = getLocaleMessageNamedKeys(value);
	return keys.length === 0 ? '' : `{ ${keys.join(', ')} }`;
}

function toLocaleTemplateFunctionType(value: LocaleValue, messageSyntax: LocaleMessageSyntax): string {
	if (typeof value === 'function') {
		return 'import("vue-internationalization/runtime").LocaleMessageFunction';
	}

	const keys = typeof value === 'string' ? getLocaleMessageNamedKeys(value, messageSyntax) : [];
	const indexes = typeof value === 'string' ? getLocaleMessageListIndexes(value) : [];
	const hasPlural = typeof value === 'string' && hasLocaleMessagePlural(value, messageSyntax);
	const usesIcu = messageSyntax === 'icu';

	if (keys.length === 0) {
		if (indexes.length > 0) {
			return `(values: import("vue-internationalization/runtime").LocaleTemplateValue[]${hasPlural ? ', plural?: number' : ''}) => string`;
		}

		if (usesIcu) {
			return '() => string';
		}

		return hasPlural ? '(plural: number) => string' : '() => string';
	}

	return `(values: { ${keys.map((key) => `${toPropertyName(key)}: import("vue-internationalization/runtime").LocaleTemplateValue;`).join(' ')} }${hasPlural && !usesIcu ? ', plural?: number' : ''}) => string`;
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
