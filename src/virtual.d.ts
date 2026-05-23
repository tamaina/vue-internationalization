declare module 'virtual:vue-internationalization' {
  import type { InternationalizationInstance } from 'vue-internationalization/runtime';

  export const primaryLocale: string;
  export const locales: string[];
  export function createInternationalization(options?: {
    initialLocale?: string;
    fallbackLocale?: string;
  }): InternationalizationInstance;
  export function setActiveInternationalization(instance: InternationalizationInstance): void;
  export function useInternationalization(): InternationalizationInstance;
  export function useLocale(moduleUrl: string): Readonly<{
    value: {
      global: Record<string, unknown>;
      module: Record<string, unknown>;
    };
  }>;
}
