import type { LocaleDictionary } from './types.js';

export type InlineBuildOptions = {
  enabled: boolean;
};

export type InlineLocalePayload = {
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

type ModuleMessages = Record<string, Record<string, LocaleDictionary>>;
type LocaleMessages = Record<string, LocaleDictionary>;
type MutableOutputChunk = {
  type: 'chunk';
  fileName: string;
  code: string;
  imports: string[];
  dynamicImports: string[];
  [key: string]: unknown;
};
type MutableOutputBundle = Record<string, unknown>;

const INLINE_MARKER_PREFIX = '__VUE_INTERNATIONALIZATION_INLINE__:';
const INLINE_CALL_RE = /__VUE_INTERNATIONALIZATION_INLINE_LOCALE__\("(__VUE_INTERNATIONALIZATION_INLINE__:[A-Za-z0-9+/=]+)"\)/g;
const INLINE_BINDING_RE =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*__VUE_INTERNATIONALIZATION_INLINE_LOCALE__\("(__VUE_INTERNATIONALIZATION_INLINE__:[A-Za-z0-9+/=]+)"\)/g;
const INLINE_TEXT_RE =
  /(?:\b[A-Za-z_$][\w$]*\.)?__VUE_INTERNATIONALIZATION_INLINE_TEXT__\("(__VUE_INTERNATIONALIZATION_INLINE__:[A-Za-z0-9+/=]+)","((?:global|module)(?:\.[A-Za-z_$][\w$]*)+)"\)/g;
const LOCALE_ACCESS_RE = /\$locale\.(global|module)((?:\.[A-Za-z_$][\w$]*)+)/g;

export function createInlineLocaleMarker(moduleId: string): string {
  return `${INLINE_MARKER_PREFIX}${Buffer.from(moduleId, 'utf8').toString('base64')}`;
}

export function injectInlineLocaleBinding(code: string, moduleId: string): string {
  const injection = [
    '',
    `const $locale = __VUE_INTERNATIONALIZATION_INLINE_LOCALE__(${JSON.stringify(createInlineLocaleMarker(moduleId))});`,
    ''
  ].join('\n');

  const setupOpen = code.match(/<script\b(?=[^>]*\bsetup\b)[^>]*>/);

  if (setupOpen?.index != null) {
    const insertAt = setupOpen.index + setupOpen[0].length;
    return `${code.slice(0, insertAt)}${injection}${code.slice(insertAt)}`;
  }

  return `${code}\n<script setup lang="ts">${injection}</script>\n`;
}

export function rewriteInlineLocaleTemplateAccess(code: string, moduleId: string): string {
  const marker = createInlineLocaleMarker(moduleId);

  return code.replace(/<template\b[^>]*>[\s\S]*?<\/template>/g, (template) =>
    template.replace(LOCALE_ACCESS_RE, (_match, scope: 'global' | 'module', pathExpression: string) =>
      `__VUE_INTERNATIONALIZATION_INLINE_TEXT__(${JSON.stringify(marker)},${JSON.stringify(`${scope}${pathExpression}`)})`
    )
  );
}

export function inlineLocaleChunks(
  bundle: MutableOutputBundle,
  locales: string[],
  primaryLocale: string,
  modules: ModuleMessages,
  globalMessages: LocaleMessages
): InlineChunkManifest {
  const manifest: InlineChunkManifest = {
    primaryLocale,
    entries: []
  };
  const localizableChunks = Object.values(bundle)
    .filter((chunk): chunk is MutableOutputChunk => isMutableOutputChunk(chunk) && chunk.code.includes(INLINE_MARKER_PREFIX))
    .map((chunk) => ({
      chunk,
      originalCode: chunk.code,
      originalFileName: chunk.fileName
    }));
  const localizableFiles = new Set(localizableChunks.map(({ originalFileName }) => originalFileName));

  for (const { chunk, originalCode, originalFileName } of localizableChunks) {
    const primaryFileName = addLocaleToFileName(originalFileName, primaryLocale);
    const localeFiles: Record<string, string> = {
      [primaryLocale]: primaryFileName
    };

    for (const locale of locales) {
      const localizedChunk: MutableOutputChunk = locale === primaryLocale ? chunk : {
        ...chunk,
        fileName: addLocaleToFileName(originalFileName, locale)
      };

      localizedChunk.fileName = addLocaleToFileName(originalFileName, locale);
      localizedChunk.imports = chunk.imports.map((fileName) => addLocaleToImportedFileName(localizableFiles, fileName, locale));
      localizedChunk.dynamicImports = chunk.dynamicImports.map((fileName) =>
        addLocaleToImportedFileName(localizableFiles, fileName, locale)
      );
      localizedChunk.code = replaceChunkFileReferences(
        replaceInlineLocaleMarkers(originalCode, locale, primaryLocale, modules, globalMessages),
        localizableFiles,
        locale
      );

      bundle[localizedChunk.fileName] = localizedChunk;
      localeFiles[locale] = localizedChunk.fileName;
    }

    delete bundle[originalFileName];
    manifest.entries.push({
      fileName: primaryFileName,
      originalFileName,
      locales: localeFiles
    });
  }

  return manifest;
}

export function replaceInlineLocaleMarkers(
  code: string,
  locale: string,
  primaryLocale: string,
  modules: ModuleMessages,
  globalMessages: LocaleMessages
): string {
  return replaceInlineLocaleObjects(
    replaceInlineLocaleTextAccess(replaceInlineLocaleMemberAccess(code, locale, primaryLocale, modules, globalMessages), locale, primaryLocale, modules, globalMessages),
    locale,
    primaryLocale,
    modules,
    globalMessages
  );
}

export function replaceInlineLocaleTextAccess(
  code: string,
  locale: string,
  primaryLocale: string,
  modules: ModuleMessages,
  globalMessages: LocaleMessages
): string {
  return code.replaceAll(INLINE_TEXT_RE, (_match, marker: string, path: string) => {
    const moduleId = decodeInlineLocaleMarker(marker);
    const [scope, ...keys] = path.split('.') as ['global' | 'module', ...string[]];
    const payload: InlineLocalePayload = {
      global: mergeWithPrimary(globalMessages[locale], globalMessages[primaryLocale]),
      module: mergeWithPrimary(modules[moduleId]?.[locale], modules[moduleId]?.[primaryLocale])
    };
    const value = getValueByPath(payload[scope], keys);

    return JSON.stringify(value ?? `$locale.${path}`);
  });
}

export function replaceInlineLocaleMemberAccess(
  code: string,
  locale: string,
  primaryLocale: string,
  modules: ModuleMessages,
  globalMessages: LocaleMessages
): string {
  let next = code;

  for (const match of code.matchAll(INLINE_BINDING_RE)) {
    const [, variableName, marker] = match;

    if (!variableName || !marker) {
      continue;
    }

    const moduleId = decodeInlineLocaleMarker(marker);
    const payload: InlineLocalePayload = {
      global: mergeWithPrimary(globalMessages[locale], globalMessages[primaryLocale]),
      module: mergeWithPrimary(modules[moduleId]?.[locale], modules[moduleId]?.[primaryLocale])
    };

    next = replacePayloadMemberAccess(next, variableName, payload);
  }

  return next;
}

function replaceInlineLocaleObjects(
  code: string,
  locale: string,
  primaryLocale: string,
  modules: ModuleMessages,
  globalMessages: LocaleMessages
): string {
  return code.replaceAll(INLINE_CALL_RE, (_match, marker: string) => {
    const moduleId = decodeInlineLocaleMarker(marker);
    const payload: InlineLocalePayload = {
      global: createFallbackObject(mergeWithPrimary(globalMessages[locale], globalMessages[primaryLocale]), 'global'),
      module: createFallbackObject(mergeWithPrimary(modules[moduleId]?.[locale], modules[moduleId]?.[primaryLocale]), 'module')
    };

    return JSON.stringify(payload);
  });
}

export function inlineLocaleHtml(bundle: MutableOutputBundle, manifest: InlineChunkManifest): void {
  for (const asset of Object.values(bundle)) {
    if (!isMutableOutputAsset(asset) || typeof asset.source !== 'string' || !asset.fileName.endsWith('.html')) {
      continue;
    }

    asset.source = replaceInlineLocaleHtml(asset.source, manifest);
  }
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
      locales: entry.locales
    };

    for (const [locale, fileName] of Object.entries(entry.locales)) {
      manifest[`${key}?locale=${locale}`] = {
        ...value,
        file: fileName,
        locale,
        isInternationalizationLocale: true
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

function replaceChunkFileReferences(code: string, localizableFiles: Set<string>, locale: string): string {
  let next = code;

  for (const fileName of localizableFiles) {
    next = next.replaceAll(fileName, addLocaleToFileName(fileName, locale));
    next = next.replaceAll(baseName(fileName), baseName(addLocaleToFileName(fileName, locale)));
  }

  return next;
}

function replacePayloadMemberAccess(code: string, variableName: string, payload: InlineLocalePayload): string {
  const memberRe = new RegExp(`\\b${escapeRegExp(variableName)}\\.(global|module)((?:\\.[A-Za-z_$][\\w$]*)+)`, 'gu');

  return code.replace(memberRe, (match, scope: 'global' | 'module', pathExpression: string) => {
    const path = pathExpression.slice(1).split('.');
    const value = getValueByPath(payload[scope], path);

    return JSON.stringify(value ?? `$locale.${[scope, ...path].join('.')}`);
  });
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
    }
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

function isMutableOutputAsset(value: unknown): value is { type: 'asset'; fileName: string; source: string | Uint8Array } {
  if (value == null || typeof value !== 'object') {
    return false;
  }

  const maybeAsset = value as { type?: unknown; fileName?: unknown };

  return maybeAsset.type === 'asset' && typeof maybeAsset.fileName === 'string';
}

function replaceEntryScript(html: string, localeFiles: Record<string, string>, primaryLocale: string): string {
  const primaryFile = localeFiles[primaryLocale];
  const candidates = new Set([
    originalFileNameFromLocaleFile(primaryFile, primaryLocale),
    ...Object.values(localeFiles)
  ]);
  const scriptRe = new RegExp(
    `<script\\b([^>]*?)\\bsrc=["']/(?:${[...candidates].map(escapeRegExp).join('|')})["']([^>]*)></script>`,
    'u'
  );
  const replacement = [
    '<script type="module">',
    `const __vueInternationalizationLocale = new URL(window.location.href).searchParams.get("locale") || ${JSON.stringify(primaryLocale)};`,
    `const __vueInternationalizationEntries = ${JSON.stringify(toAbsoluteLocaleFiles(localeFiles))};`,
    `import(__vueInternationalizationEntries[__vueInternationalizationLocale] || __vueInternationalizationEntries[${JSON.stringify(primaryLocale)}]);`,
    '</script>'
  ].join('');

  return html.replace(scriptRe, replacement);
}

function toAbsoluteLocaleFiles(localeFiles: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(localeFiles).map(([locale, fileName]) => [locale, `/${fileName}`]));
}

function findManifestEntry(
  manifest: Record<string, Record<string, unknown>>,
  fileNames: string[]
): [string, Record<string, unknown>] | undefined {
  return Object.entries(manifest).find(([, value]) => typeof value.file === 'string' && fileNames.includes(value.file));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
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
