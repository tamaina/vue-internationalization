import { describe, expect, it } from 'vitest';
import { createInternationalization, setActiveInternationalization, useLocale } from '../src/runtime.js';

describe('runtime locale fallback', () => {
  it('falls back to the primary locale and then the full locale expression', async () => {
    const internationalization = createInternationalization({
      primaryLocale: 'ja-JP',
      initialLocale: 'en-US',
      loaders: {
        'en-US': () =>
          Promise.resolve({
            global: {},
            modules: {
              '/src/App.vue': {
                title: 'foo'
              }
            }
          }),
        'ja-JP': () =>
          Promise.resolve({
            global: {
              fuga: 'ふが'
            },
            modules: {
              '/src/App.vue': {
                title: 'ほげ',
                nested: {
                  value: 'primary'
                }
              }
            }
          })
      }
    });

    await internationalization.ready;
    await internationalization.loadLocale('ja-JP');
    setActiveInternationalization(internationalization);

    const locale = useLocale('/src/App.vue') as unknown as {
      value: {
        global: Record<string, unknown>;
        module: Record<string, Record<string, unknown> | string>;
      };
    };
    const moduleMessages = locale.value.module;

    expect(moduleMessages.title).toBe('foo');
    expect(locale.value.global.fuga).toBe('ふが');
    expect((moduleMessages.nested as Record<string, unknown>).value).toBe('primary');
    expect(locale.value.module.missing).toBe('$locale.module.missing');
  });
});
