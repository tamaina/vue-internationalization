declare module 'virtual:vue-internationalization' {
  import type { I18nInstance } from 'vue-internationalization/runtime';

  export const primaryLocale: string;
  export const locales: string[];
  export function createI18n(options?: {
    initialLocale?: string;
    fallbackLocale?: string;
  }): I18nInstance;
  export function setActiveI18n(instance: I18nInstance): void;
  export function useI18n(): I18nInstance;
  export function useLocale(moduleUrl: string): Readonly<{
    value: {
      global: Record<string, unknown>;
      module: Record<string, unknown>;
    };
  }>;
}
