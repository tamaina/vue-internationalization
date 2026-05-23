import { parse as parseSfc } from '@vue/compiler-sfc';
import YAML from 'yaml';
import type { LocaleDictionary, ParsedVueLocale } from './types.js';

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
        end: range.end
      };
    });

  return {
    code,
    moduleId: normalizeModuleId(filename),
    blocks
  };
}

export function parseLocaleDictionary(content: string, lang: string, sourceLabel: string): LocaleDictionary {
  const normalized = lang.toLowerCase();

  try {
    if (normalized === 'json') {
      return asDictionary(JSON.parse(content), sourceLabel);
    }

    if (normalized === 'yaml' || normalized === 'yml') {
      return asDictionary(YAML.parse(content) ?? {}, sourceLabel);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${sourceLabel}: ${message}`);
  }

  throw new Error(`Unsupported locale lang "${lang}" in ${sourceLabel}. Use yaml, yml, or json.`);
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

export function injectLocaleBinding(code: string): string {
  const injection = [
    '',
    'import { useLocale as __useLocale } from "virtual:vue-internationalization";',
    'const $locale = __useLocale(import.meta.url);',
    ''
  ].join('\n');

  const setupOpen = code.match(/<script\b(?=[^>]*\bsetup\b)[^>]*>/);

  if (setupOpen?.index != null) {
    const insertAt = setupOpen.index + setupOpen[0].length;
    return `${code.slice(0, insertAt)}${injection}${code.slice(insertAt)}`;
  }

  return `${code}\n<script setup lang="ts">${injection}</script>\n`;
}

export function transformVueSfc(code: string, filename: string): string | undefined {
  const parsed = parseVueLocales(code, filename);

  if (parsed.blocks.length === 0) {
    return undefined;
  }

  return injectLocaleBinding(stripLocaleBlocks(code, filename));
}

export function normalizeModuleId(id: string): string {
  const withoutQuery = id.split('?', 1)[0] ?? id;
  return withoutQuery.replace(/\\/g, '/');
}

function asDictionary(value: unknown, sourceLabel: string): LocaleDictionary {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${sourceLabel} must contain an object at the top level.`);
  }

  return value as LocaleDictionary;
}

function findCustomBlockRange(code: string, contentStart: number, contentEnd: number, filename: string) {
  const start = code.lastIndexOf('<locale', contentStart);
  const closeStart = code.indexOf('</locale>', contentEnd);

  if (start < 0 || closeStart < 0) {
    throw new Error(`Unable to locate complete <locale> block in ${filename}.`);
  }

  return {
    start,
    end: closeStart + '</locale>'.length
  };
}
