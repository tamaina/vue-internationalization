import type { App, InjectionKey } from 'vue';
import { computed, inject, reactive, readonly } from 'vue';
import type { LocaleDictionary } from './types.js';

export type RuntimeLocaleDictionary = LocaleDictionary;

export type LocaleBundle = {
  global: RuntimeLocaleDictionary;
  modules: Record<string, RuntimeLocaleDictionary>;
};

export type LocaleLoader = () => Promise<LocaleBundle | { default: LocaleBundle }>;

export type I18nRuntimeOptions = {
  primaryLocale: string;
  initialLocale?: string;
  fallbackLocale?: string;
  loaders: Record<string, LocaleLoader>;
};

export type I18nInstance = {
  locale: string;
  primaryLocale: string;
  ready: Promise<void>;
  loadLocale(locale: string): Promise<void>;
  setLocale(locale: string): Promise<void>;
  install(app: App): void;
};

type I18nState = {
  locale: string;
  primaryLocale: string;
  fallbackLocale: string;
  bundles: Record<string, LocaleBundle>;
};

const I18N_KEY: InjectionKey<I18nInstance> = Symbol('vue-internationalization');
const EMPTY_DICTIONARY: RuntimeLocaleDictionary = {};
const STATES = new WeakMap<I18nInstance, I18nState>();
let activeI18n: I18nInstance | undefined;

export function createI18n(options: I18nRuntimeOptions): I18nInstance {
  const state = reactive<I18nState>({
    locale: options.initialLocale ?? options.primaryLocale,
    primaryLocale: options.primaryLocale,
    fallbackLocale: options.fallbackLocale ?? options.primaryLocale,
    bundles: {}
  });

  const instance: I18nInstance = {
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
    },
    install(app) {
      app.provide(I18N_KEY, instance);
      app.config.globalProperties.$setLocale = instance.setLocale.bind(instance);
      setActiveI18n(instance);
    }
  };

  STATES.set(instance, state);
  instance.ready = instance.loadLocale(state.locale).catch((error) => {
    console.error(error);
  });

  return instance;
}

export function setActiveI18n(instance: I18nInstance): void {
  activeI18n = instance;
}

export function useI18n(): I18nInstance {
  const i18n = inject(I18N_KEY, activeI18n);

  if (!i18n) {
    throw new Error('vue-internationalization is not installed. Call app.use(createI18n()).');
  }

  return i18n;
}

export function useLocale(moduleUrl: string) {
  const i18n = useI18n();

  return readonly(computed(() => resolveLocale(i18n, moduleUrl)));
}

function resolveLocale(i18n: I18nInstance, moduleUrl: string) {
  const state = getState(i18n);
  const current = state.bundles[state.locale];
  const fallback = state.bundles[state.fallbackLocale];
  const moduleId = normalizeRuntimeModuleUrl(moduleUrl);

  return {
    global: current?.global ?? fallback?.global ?? EMPTY_DICTIONARY,
    module: current?.modules[moduleId] ?? fallback?.modules[moduleId] ?? EMPTY_DICTIONARY
  };
}

function getState(i18n: I18nInstance): I18nState {
  const state = STATES.get(i18n);

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
