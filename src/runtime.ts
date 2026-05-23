import type { App, InjectionKey } from 'vue';
import { computed, hasInjectionContext, inject, reactive, readonly } from 'vue';
import type { LocaleDictionary } from './types.js';

export type RuntimeLocaleDictionary = LocaleDictionary;

export type LocaleBundle = {
  global: RuntimeLocaleDictionary;
  modules: Record<string, RuntimeLocaleDictionary>;
};

export type LocaleLoader = () => Promise<LocaleBundle | { default: LocaleBundle }>;

export type InternationalizationRuntimeOptions = {
  primaryLocale: string;
  initialLocale?: string;
  fallbackLocale?: string;
  loaders: Record<string, LocaleLoader>;
  onLocaleChange?: (locale: string) => void | Promise<void>;
};

export type InternationalizationInstance = {
  locale: string;
  primaryLocale: string;
  ready: Promise<void>;
  loadLocale(locale: string): Promise<void>;
  setLocale(locale: string): Promise<void>;
  install(app: App): void;
};

type InternationalizationState = {
  locale: string;
  primaryLocale: string;
  fallbackLocale: string;
  bundles: Record<string, LocaleBundle>;
};

const INTERNATIONALIZATION_KEY: InjectionKey<InternationalizationInstance> = Symbol('vue-internationalization');
const EMPTY_DICTIONARY: RuntimeLocaleDictionary = {};
const STATES = new WeakMap<InternationalizationInstance, InternationalizationState>();
let activeInternationalization: InternationalizationInstance | undefined;

export function createInternationalization(options: InternationalizationRuntimeOptions): InternationalizationInstance {
  const state = reactive<InternationalizationState>({
    locale: options.initialLocale ?? options.primaryLocale,
    primaryLocale: options.primaryLocale,
    fallbackLocale: options.fallbackLocale ?? options.primaryLocale,
    bundles: {}
  });

  const instance: InternationalizationInstance = {
    get locale() {
      return state.locale;
    },
    get primaryLocale() {
      return state.primaryLocale;
    },
    ready: Promise.resolve(),
    async loadLocale(locale) {
      if (state.bundles[locale]) {
        return;
      }

      const loader = options.loaders[locale];

      if (!loader) {
        throw new Error(`Locale "${locale}" is not available.`);
      }

      const loaded = await loader();
      const bundle = 'default' in loaded ? loaded.default : loaded;
      state.bundles[locale] = {
        global: bundle.global ?? {},
        modules: bundle.modules ?? {}
      };
    },
    async setLocale(locale) {
      await this.loadLocale(locale);
      state.locale = locale;
      await options.onLocaleChange?.(locale);
    },
    install(app) {
      app.provide(INTERNATIONALIZATION_KEY, instance);
      app.config.globalProperties.$setLocale = instance.setLocale.bind(instance);
      setActiveInternationalization(instance);
    }
  };

  STATES.set(instance, state);
  instance.ready = instance.loadLocale(state.locale).catch((error) => {
    console.error(error);
  });

  return instance;
}

export function setActiveInternationalization(instance: InternationalizationInstance): void {
  activeInternationalization = instance;
}

export function useInternationalization(): InternationalizationInstance {
  const internationalization = hasInjectionContext()
    ? inject(INTERNATIONALIZATION_KEY, activeInternationalization)
    : activeInternationalization;

  if (!internationalization) {
    throw new Error('vue-internationalization is not installed. Call app.use(createInternationalization()).');
  }

  return internationalization;
}

export function useLocale(moduleUrl: string) {
  const internationalization = useInternationalization();

  return readonly(computed(() => resolveLocale(internationalization, moduleUrl)));
}

function resolveLocale(internationalization: InternationalizationInstance, moduleUrl: string) {
  const state = getState(internationalization);
  const current = state.bundles[state.locale];
  const fallback = state.bundles[state.primaryLocale] ?? state.bundles[state.fallbackLocale];
  const moduleId = normalizeRuntimeModuleUrl(moduleUrl);

  return {
    global: createFallbackDictionary(current?.global, fallback?.global, 'global'),
    module: createFallbackDictionary(current?.modules[moduleId], fallback?.modules[moduleId], 'module')
  };
}

function createFallbackDictionary(
  current: RuntimeLocaleDictionary | undefined,
  fallback: RuntimeLocaleDictionary | undefined,
  scope: string
): RuntimeLocaleDictionary {
  return createDictionaryProxy(current ?? EMPTY_DICTIONARY, fallback ?? EMPTY_DICTIONARY, [scope]);
}

function createDictionaryProxy(
  current: RuntimeLocaleDictionary,
  fallback: RuntimeLocaleDictionary,
  path: string[]
): RuntimeLocaleDictionary {
  return new Proxy(current, {
    get(target, property) {
      if (typeof property !== 'string') {
        return Reflect.get(target, property);
      }

      const value = getOwnValue(target, property);
      const fallbackValue = getOwnValue(fallback, property);
      const nextPath = [...path, property];

      if (isDictionary(value) || isDictionary(fallbackValue)) {
        return createDictionaryProxy(asDictionary(value), asDictionary(fallbackValue), nextPath);
      }

      return value ?? fallbackValue ?? `$locale.${nextPath.join('.')}`;
    }
  }) as RuntimeLocaleDictionary;
}

function getOwnValue(dictionary: RuntimeLocaleDictionary, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(dictionary, key) ? dictionary[key] : undefined;
}

function isDictionary(value: unknown): value is RuntimeLocaleDictionary {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function asDictionary(value: unknown): RuntimeLocaleDictionary {
  return isDictionary(value) ? value : EMPTY_DICTIONARY;
}

function getState(internationalization: InternationalizationInstance): InternationalizationState {
  const state = STATES.get(internationalization);

  if (!state) {
    throw new Error('Invalid vue-internationalization instance.');
  }

  return state;
}

function normalizeRuntimeModuleUrl(moduleUrl: string): string {
  const withoutQuery = moduleUrl.split('?', 1)[0]?.replace(/\\/g, '/') ?? moduleUrl;

  try {
    return new URL(withoutQuery).pathname;
  } catch {
    return withoutQuery;
  }
}
