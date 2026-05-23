import { parse as parseIcuMessage, TYPE } from '@formatjs/icu-messageformat-parser';
import IntlMessageFormat from 'intl-messageformat';
import type { MessageFormatElement } from '@formatjs/icu-messageformat-parser';

export type LocaleMessageValue = string | number | bigint | boolean | null | undefined | Date;
export type LocaleMessageNamedValues = Record<string, LocaleMessageValue>;
export type LocaleMessageListValues = LocaleMessageValue[];
export type LocaleMessageValues = LocaleMessageNamedValues | LocaleMessageListValues;
export type LocaleMessageSyntax = 'vue' | 'icu';

export type LocaleMessageToken =
	| { type: 'text'; value: string }
	| { type: 'named'; key: string }
	| { type: 'list'; index: number }
	| { type: 'literal'; value: string }
	| { type: 'linked'; key: string; modifier?: string };

export type LocaleMessageAst = {
	cases: LocaleMessageToken[][];
};

export type LocaleMessageContext = {
	locale?: string;
	syntax?: LocaleMessageSyntax;
	values?: LocaleMessageValues;
	plural?: number;
	resolveLinked?: (key: string) => string;
};

const MESSAGE_CACHE_LIMIT = 500;
const MESSAGE_CACHE = new Map<string, LocaleMessageAst>();
const ICU_MESSAGE_CACHE = new Map<string, IntlMessageFormat>();
const ICU_ARGUMENT_CACHE = new Map<string, string[]>();
const ICU_MESSAGE_RE = /\{\s*[$A-Z_a-z][\w$-]*\s*,\s*(?:plural|select|selectordinal)\s*,/u;

export function isIcuLocaleMessage(message: string): boolean {
	return ICU_MESSAGE_RE.test(message);
}

export function compileLocaleMessage(message: string): LocaleMessageAst {
	const cached = MESSAGE_CACHE.get(message);

	if (cached) {
		return cached;
	}

	const ast = {
		cases: splitPluralCases(message).map(parseMessageCase),
	};

	if (MESSAGE_CACHE.size >= MESSAGE_CACHE_LIMIT) {
		const oldestKey = MESSAGE_CACHE.keys().next().value;

		if (oldestKey !== undefined) {
			MESSAGE_CACHE.delete(oldestKey);
		}
	}

	MESSAGE_CACHE.set(message, ast);
	return ast;
}

export function formatLocaleMessage(message: string, context: LocaleMessageContext = {}): string {
	if (context.syntax === 'icu') {
		const formatter = getIcuMessageFormatter(message, context.locale);
		const values = context.values && !Array.isArray(context.values) ? context.values : undefined;
		const formatted = formatter.format(values);
		return Array.isArray(formatted) ? formatted.join('') : String(formatted);
	}

	const ast = compileLocaleMessage(message);
	const tokens = ast.cases[selectPluralCase(ast.cases.length, context.plural)];

	return tokens.map((token) => formatToken(token, context)).join('');
}

export function getLocaleMessageNamedKeys(message: string, syntax: LocaleMessageSyntax = 'vue'): string[] {
	if (syntax === 'icu') {
		return getIcuLocaleMessageArgumentKeys(message);
	}

	const keys: string[] = [];

	for (const tokens of compileLocaleMessage(message).cases) {
		for (const token of tokens) {
			if (token.type === 'named' && !keys.includes(token.key)) {
				keys.push(token.key);
			}
		}
	}

	return keys;
}

export function getLocaleMessageListIndexes(message: string): number[] {
	const indexes: number[] = [];

	for (const tokens of compileLocaleMessage(message).cases) {
		for (const token of tokens) {
			if (token.type === 'list' && !indexes.includes(token.index)) {
				indexes.push(token.index);
			}
		}
	}

	return indexes.sort((left, right) => left - right);
}

export function hasLocaleMessagePlural(message: string, syntax: LocaleMessageSyntax = 'vue'): boolean {
	if (syntax === 'icu') {
		return true;
	}

	return compileLocaleMessage(message).cases.length > 1;
}

export function getLocaleMessageLinkedKeys(message: string): string[] {
	const keys: string[] = [];

	for (const tokens of compileLocaleMessage(message).cases) {
		for (const token of tokens) {
			if (token.type === 'linked' && !keys.includes(token.key)) {
				keys.push(token.key);
			}
		}
	}

	return keys;
}

function getIcuMessageFormatter(message: string, locale: string | undefined): IntlMessageFormat {
	const key = `${locale ?? ''}\n${message}`;
	const cached = ICU_MESSAGE_CACHE.get(key);

	if (cached) {
		return cached;
	}

	const formatter = new IntlMessageFormat(message, locale);

	if (ICU_MESSAGE_CACHE.size >= MESSAGE_CACHE_LIMIT) {
		const oldestKey = ICU_MESSAGE_CACHE.keys().next().value;

		if (oldestKey !== undefined) {
			ICU_MESSAGE_CACHE.delete(oldestKey);
		}
	}

	ICU_MESSAGE_CACHE.set(key, formatter);
	return formatter;
}

function getIcuLocaleMessageArgumentKeys(message: string): string[] {
	const cached = ICU_ARGUMENT_CACHE.get(message);

	if (cached) {
		return cached;
	}

	const keys: string[] = [];
	collectIcuArgumentKeys(parseIcuMessage(message), keys);

	if (ICU_ARGUMENT_CACHE.size >= MESSAGE_CACHE_LIMIT) {
		const oldestKey = ICU_ARGUMENT_CACHE.keys().next().value;

		if (oldestKey !== undefined) {
			ICU_ARGUMENT_CACHE.delete(oldestKey);
		}
	}

	ICU_ARGUMENT_CACHE.set(message, keys);
	return keys;
}

function collectIcuArgumentKeys(elements: MessageFormatElement[], keys: string[]): void {
	for (const element of elements) {
		switch (element.type) {
			case TYPE.argument:
			case TYPE.number:
			case TYPE.date:
			case TYPE.time:
				pushUnique(keys, element.value);
				break;
			case TYPE.select:
			case TYPE.plural:
				pushUnique(keys, element.value);
				for (const option of Object.values(element.options)) {
					collectIcuArgumentKeys(option.value, keys);
				}
				break;
			case TYPE.tag:
				collectIcuArgumentKeys(element.children, keys);
				break;
		}
	}
}

function pushUnique(values: string[], value: string): void {
	if (!values.includes(value)) {
		values.push(value);
	}
}

function formatToken(token: LocaleMessageToken, context: LocaleMessageContext): string {
	switch (token.type) {
		case 'text':
			return token.value;
		case 'named':
			return formatNamed(token.key, context.values);
		case 'list':
			return formatList(token.index, context.values);
		case 'literal':
			return token.value;
		case 'linked':
			return formatLinked(token, context);
	}
}

function formatNamed(key: string, values: LocaleMessageValues | undefined): string {
	if (!values || Array.isArray(values)) {
		return `{${key}}`;
	}

	const value = values[key];
	return value == null ? `{${key}}` : String(value);
}

function formatList(index: number, values: LocaleMessageValues | undefined): string {
	if (!Array.isArray(values)) {
		return `{${index}}`;
	}

	const value = values[index];
	return value == null ? `{${index}}` : String(value);
}

function formatLinked(token: Extract<LocaleMessageToken, { type: 'linked' }>, context: LocaleMessageContext): string {
	const value = context.resolveLinked?.(token.key) ?? `@:${token.key}`;

	if (!token.modifier) {
		return value;
	}

	switch (token.modifier) {
		case 'upper':
			return value.toLocaleUpperCase(context.locale);
		case 'lower':
			return value.toLocaleLowerCase(context.locale);
		case 'capitalize':
			return value.charAt(0).toLocaleUpperCase(context.locale) + value.slice(1);
		default:
			return value;
	}
}

function selectPluralCase(length: number, plural: number | undefined): number {
	if (length <= 1) {
		return 0;
	}

	const choice = Math.abs(Math.trunc(plural ?? 1));
	const index = length === 2
		? choice === 1 ? 0 : 1
		: choice === 0 ? 0 : choice === 1 ? 1 : 2;

	return Math.min(index, length - 1);
}

function splitPluralCases(message: string): string[] {
	const cases: string[] = [];
	let cursor = 0;
	let braceDepth = 0;
	let quote: string | undefined;

	for (let index = 0; index < message.length; index++) {
		const char = message[index];
		const previous = message[index - 1];

		if (quote) {
			if (char === quote && previous !== '\\') {
				quote = undefined;
			}
			continue;
		}

		if ((char === '\'' || char === '"') && braceDepth > 0) {
			quote = char;
			continue;
		}

		if (char === '{') {
			braceDepth++;
			continue;
		}

		if (char === '}' && braceDepth > 0) {
			braceDepth--;
			continue;
		}

		if (char === '|' && braceDepth === 0) {
			cases.push(message.slice(cursor, index).trim());
			cursor = index + 1;
		}
	}

	cases.push(message.slice(cursor).trim());
	return cases;
}

function parseMessageCase(message: string): LocaleMessageToken[] {
	const tokens: LocaleMessageToken[] = [];
	let cursor = 0;

	while (cursor < message.length) {
		const interpolation = findNextInterpolation(message, cursor);
		const linked = findNextLinked(message, cursor);
		const next = pickEarlier(interpolation, linked);

		if (!next) {
			pushText(tokens, message.slice(cursor));
			break;
		}

		if (next.start > cursor) {
			pushText(tokens, message.slice(cursor, next.start));
		}

		tokens.push(next.token);
		cursor = next.end;
	}

	return tokens.length === 0 ? [{ type: 'text', value: '' }] : tokens;
}

function findNextInterpolation(message: string, cursor: number): { start: number; end: number; token: LocaleMessageToken } | undefined {
	const match = /\{([^{}]+)\}/gu.exec(message.slice(cursor));

	if (!match) {
		return undefined;
	}

	const body = match[1].trim();
	const start = cursor + match.index;
	const end = start + match[0].length;

	if (/^\d+$/u.test(body)) {
		return { start, end, token: { type: 'list', index: Number(body) } };
	}

	const literal = body.match(/^(['"])(.*)\1$/u);

	if (literal?.[2] != null) {
		return { start, end, token: { type: 'literal', value: literal[2].replaceAll('\\\'', '\'').replaceAll('\\"', '"') } };
	}

	if (/^[A-Za-z_][\w$-]*$/u.test(body)) {
		return { start, end, token: { type: 'named', key: body } };
	}

	return { start, end, token: { type: 'text', value: match[0] } };
}

function findNextLinked(message: string, cursor: number): { start: number; end: number; token: LocaleMessageToken } | undefined {
	const match = /@(?:\.([A-Za-z_$][\w$-]*))?:(?:\{(['"])(.*?)\2\}|([A-Za-z_$][\w$.-]*))/u.exec(message.slice(cursor));

	if (!match) {
		return undefined;
	}

	const start = cursor + match.index;
	const end = start + match[0].length;
	const key = match[3] || match[4];

	if (!key) {
		return undefined;
	}

	return {
		start,
		end,
		token: {
			type: 'linked',
			key,
			modifier: match[1],
		},
	};
}

function pickEarlier(
	left: { start: number; end: number; token: LocaleMessageToken } | undefined,
	right: { start: number; end: number; token: LocaleMessageToken } | undefined,
): { start: number; end: number; token: LocaleMessageToken } | undefined {
	if (!left) {
		return right;
	}

	if (!right) {
		return left;
	}

	return left.start <= right.start ? left : right;
}

function pushText(tokens: LocaleMessageToken[], value: string): void {
	if (value.length === 0) {
		return;
	}

	const last = tokens.at(-1);

	if (last?.type === 'text') {
		last.value += value;
		return;
	}

	tokens.push({ type: 'text', value });
}
