import './ambient.js';

export { vueInternationalization } from './plugin.js';
export type {
  LocaleDictionary,
  LocaleMessages,
  VueInternationalizationOptions
} from './plugin.js';
export {
  createI18n,
  setActiveI18n,
  useI18n,
  useLocale
} from './runtime.js';
export type {
  I18nInstance,
  I18nRuntimeOptions,
  LocaleBundle,
  LocaleLoader,
  RuntimeLocaleDictionary
} from './runtime.js';
