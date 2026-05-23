import 'vue';

declare module 'vue' {
  interface ComponentCustomProperties {
    $setLocale: (locale: string) => Promise<void>;
  }
}
