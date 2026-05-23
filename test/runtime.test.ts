import { describe, expect, it } from 'vitest';
import { h } from 'vue';
import { Internationalization, createInternationalization, formatLocaleTemplate, setActiveInternationalization, useDateTimeFormat, useLocale, useLocalizer, useNumberFormat } from '../src/runtime.js';

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
								title: 'foo',
							},
						},
					}),
				'ja-JP': () =>
					Promise.resolve({
						global: {
							fuga: 'ふが',
						},
						modules: {
							'/src/App.vue': {
								title: 'ほげ',
								nested: {
									value: 'primary',
								},
							},
						},
					}),
			},
		});

		await internationalization.ready;
		await internationalization.loadLocale('ja-JP');
		setActiveInternationalization(internationalization);

		const locale = useLocale('/src/App.vue') as unknown as {
			value: {
				env: Record<string, unknown>;
				sfc: Record<string, Record<string, unknown> | string>;
			};
		};
		const moduleMessages = locale.value.sfc;

		expect(moduleMessages.title).toBe('foo');
		expect(locale.value.env.fuga).toBe('ふが');
		expect((moduleMessages.nested as Record<string, unknown>).value).toBe('primary');
		expect(locale.value.sfc.missing).toBe('$locale.sfc.missing');
	});

	it('formats localizer templates with fallback locale values', async () => {
		const internationalization = createInternationalization({
			primaryLocale: 'ja-JP',
			initialLocale: 'en-US',
			loaders: {
				'en-US': () =>
					Promise.resolve({
						modules: {
							'/src/App.vue': {
								nApples: '{n} apples',
							},
						},
					}),
				'ja-JP': () =>
					Promise.resolve({
						modules: {
							'/src/App.vue': {
								nApples: '{n} 個のりんご',
								nOranges: '{n} 個のみかん',
							},
						},
					}),
			},
		});

		await internationalization.ready;
		await internationalization.loadLocale('ja-JP');
		setActiveInternationalization(internationalization);

		const localizer = useLocalizer('/src/App.vue') as unknown as {
			value: {
				sfc: {
					nApples: (values: { n: number }) => string;
					nOranges: (values: { n: number }) => string;
				};
			};
		};

		expect(localizer.value.sfc.nApples({ n: 3 })).toBe('3 apples');
		expect(localizer.value.sfc.nOranges({ n: 4 })).toBe('4 個のみかん');
	});

	it('calls message functions from localizer dictionaries', async () => {
		const internationalization = createInternationalization({
			primaryLocale: 'en-US',
			loaders: {
				'en-US': () =>
					Promise.resolve({
						global: {
							greeting: (values?: { name?: string }) => `Hello ${values?.name ?? 'there'}`,
						},
						modules: {
							'/src/App.vue': {
								apples: (values?: { count?: number }, plural?: number) => `${values?.count ?? plural ?? 0} apples`,
							},
						},
					}),
			},
		});

		await internationalization.ready;
		setActiveInternationalization(internationalization);

		const localizer = useLocalizer('/src/App.vue') as unknown as {
			value: {
				env: {
					greeting: (values: { name: string }) => string;
				};
				sfc: {
					apples: (values: { count: number }, plural?: number) => string;
				};
			};
		};

		expect(localizer.value.env.greeting({ name: 'Jane' })).toBe('Hello Jane');
		expect(localizer.value.sfc.apples({ count: 3 }, 3)).toBe('3 apples');
	});

	it('keeps unresolved template parameters visible', () => {
		expect(formatLocaleTemplate('Hello {name}', {})).toBe('Hello {name}');
	});

	it('formats dates and numbers with locale-aware named presets', async () => {
		const internationalization = createInternationalization({
			primaryLocale: 'en-US',
			initialLocale: 'ja-JP',
			loaders: {
				'ja-JP': () => Promise.resolve({}),
			},
			dateTimeFormats: {
				'en-US': {
					short: {
						year: 'numeric',
						month: '2-digit',
						day: '2-digit',
						timeZone: 'UTC',
					},
				},
				'ja-JP': {
					short: {
						year: 'numeric',
						month: '2-digit',
						day: '2-digit',
						timeZone: 'UTC',
					},
				},
			},
			numberFormats: {
				'en-US': {
					currency: {
						style: 'currency',
						currency: 'USD',
					},
				},
				'ja-JP': {
					currency: {
						style: 'currency',
						currency: 'JPY',
					},
				},
			},
		});

		await internationalization.ready;
		setActiveInternationalization(internationalization);

		const dateTime = useDateTimeFormat();
		const number = useNumberFormat();

		expect(dateTime.value(new Date(Date.UTC(2026, 0, 2)), 'short')).toContain('2026');
		expect(number.value(1234, 'currency')).toContain('￥1,234');
		expect(number.value(0.123, { style: 'percent', maximumFractionDigits: 1 })).toBe('12.3%');
	});

	it('renders internationalization component messages with slots', () => {
		const render = (Internationalization as unknown as {
			setup: (
				props: Record<string, unknown>,
				context: { slots: Record<string, (props: { text: string }) => unknown[]> },
			) => () => { children: unknown[] };
		}).setup({
			locale: {
				env: {
					appName: 'Example',
				},
				sfc: {
					terms: 'Read {link} for {app}. @.upper:env.appName',
				},
			},
			scope: 'sfc',
			path: 'terms',
			values: {
				app: 'Vue',
			},
		}, {
			slots: {
				link: ({ text }) => [h('a', { href: '/terms' }, text)],
			},
		});
		const vnode = render();
		const children = vnode.children as Array<string | { type: string; children: string }>;

		expect(children[0]).toBe('Read ');
		expect((children[1] as { type: string; children: string }).type).toBe('a');
		expect((children[1] as { type: string; children: string }).children).toBe('{link}');
		expect(children.slice(2).join('')).toBe(' for Vue. EXAMPLE');
	});

	it('formats vue-i18n compatible message syntax', async () => {
		const internationalization = createInternationalization({
			primaryLocale: 'en-US',
			loaders: {
				'en-US': () =>
					Promise.resolve({
						global: {
							appName: 'Example App',
							nested: {
								envTarget: 'env target',
							},
						},
						modules: {
							'/src/App.vue': {
								named: 'Hello {user-name}',
								list: '{0} world',
								literal: '{\'hello\'} world',
								car: 'car | cars',
								apple: 'no apples | one apple | {count} apples',
								name: 'World',
								linked: 'Hello @.lower:name',
								linkedEnv: 'From @:env.appName',
								linkedSfc: 'From @:sfc.name',
								nestedEnv: '@.capitalize:env.nested.envTarget',
								missingLinked: 'Missing @:missing.path',
								recursive: '@:recursive',
								nested: {
									target: 'nested target',
									linked: '@.capitalize:nested.target',
								},
							},
						},
					}),
			},
		});

		await internationalization.ready;
		setActiveInternationalization(internationalization);

		const localizer = useLocalizer('/src/App.vue') as unknown as {
			value: {
				sfc: {
					named: (values: { 'user-name': string }) => string;
					list: (values: string[]) => string;
					literal: () => string;
					car: (plural: number) => string;
					apple: (values: { count: number }, plural?: number) => string;
					linked: () => string;
					linkedEnv: () => string;
					linkedSfc: () => string;
					nestedEnv: () => string;
					missingLinked: () => string;
					recursive: () => string;
					nested: {
						linked: () => string;
					};
				};
			};
		};

		expect(localizer.value.sfc.named({ 'user-name': 'Jane' })).toBe('Hello Jane');
		expect(localizer.value.sfc.list(['hello'])).toBe('hello world');
		expect(localizer.value.sfc.literal()).toBe('hello world');
		expect(localizer.value.sfc.car(1)).toBe('car');
		expect(localizer.value.sfc.car(2)).toBe('cars');
		expect(localizer.value.sfc.apple({ count: 0 }, 0)).toBe('no apples');
		expect(localizer.value.sfc.apple({ count: 1 }, 1)).toBe('one apple');
		expect(localizer.value.sfc.apple({ count: 10 }, 10)).toBe('10 apples');
		expect(localizer.value.sfc.linked()).toBe('Hello world');
		expect(localizer.value.sfc.linkedEnv()).toBe('From Example App');
		expect(localizer.value.sfc.linkedSfc()).toBe('From World');
		expect(localizer.value.sfc.nestedEnv()).toBe('Env target');
		expect(localizer.value.sfc.missingLinked()).toBe('Missing @:missing.path');
		expect(localizer.value.sfc.recursive()).toBe('@:recursive');
		expect(localizer.value.sfc.nested.linked()).toBe('Nested target');
	});

	it('formats ICU MessageFormat syntax in ICU mode', async () => {
		const internationalization = createInternationalization({
			primaryLocale: 'en-US',
			messageSyntax: 'icu',
			loaders: {
				'en-US': () =>
					Promise.resolve({
						modules: {
							'/src/App.vue': {
								icuPlural: '{count, plural, =0 {no ICU apples} one {one ICU apple} other {# ICU apples}}',
								icuSelect: '{gender, select, female {She has {count, plural, one {one apple} other {# apples}}} other {They have {count, plural, one {one apple} other {# apples}}}}',
							},
						},
					}),
			},
		});

		await internationalization.ready;
		setActiveInternationalization(internationalization);

		const localizer = useLocalizer('/src/App.vue') as unknown as {
			value: {
				sfc: {
					icuPlural: (values: { count: number }) => string;
					icuSelect: (values: { gender: string; count: number }) => string;
				};
			};
		};

		expect(localizer.value.sfc.icuPlural({ count: 0 })).toBe('no ICU apples');
		expect(localizer.value.sfc.icuPlural({ count: 3 })).toBe('3 ICU apples');
		expect(localizer.value.sfc.icuSelect({ gender: 'female', count: 2 })).toBe('She has 2 apples');
	});
});
