import { describe, expect, it } from 'vitest';
import { internals } from '../src/plugin.js';

describe('virtual module generation', () => {
  it('generates dynamic locale loaders for chunk splitting', () => {
    const code = internals.generateRuntimeModule('ja-JP', ['en-US', 'ja-JP']);

    expect(code).toContain('() => import("virtual:vue-internationalization/locale/en-US")');
    expect(code).toContain('primaryLocale = "ja-JP"');
  });

  it('generates locale-specific payload modules', () => {
    const code = internals.generateLocaleModule(
      'en-US',
      {
        '/repo/src/App.vue': {
          'en-US': {
            hoge: 'foo'
          },
          'ja-JP': {
            hoge: 'ほげ'
          }
        }
      },
      {
        'en-US': {
          fuga: 'bar'
        }
      }
    );

    expect(code).toContain('"hoge":"foo"');
    expect(code).toContain('"fuga":"bar"');
    expect(code).not.toContain('ほげ');
  });
});
