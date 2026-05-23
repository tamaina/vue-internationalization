import './ambient.js';

export { vueInternationalization } from './plugin.js';
export type {
  LocaleDictionary,
  LocaleMessages,
  VueInternationalizationOptions
} from './plugin.js';
export {
  createInternationalization,
  setActiveInternationalization,
  useInternationalization,
  useLocale
} from './runtime.js';
export type {
  InternationalizationInstance,
  InternationalizationRuntimeOptions,
  LocaleBundle,
  LocaleLoader,
  RuntimeLocaleDictionary
} from './runtime.js';
