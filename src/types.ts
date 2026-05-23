export type LocaleCode = string;
export type LocaleMessageFunction<TValues = unknown> = {
	bivarianceHack(values?: TValues, plural?: number): string;
}['bivarianceHack'];
export type LocaleValue = string | number | boolean | null | LocaleMessageFunction | LocaleDictionary | LocaleValue[];
export interface LocaleDictionary {
	[key: string]: LocaleValue;
}

export type SfcLocaleBlock = {
	locale: LocaleCode;
	lang: string;
	content: string;
	start: number;
	end: number;
};

export type ParsedVueLocale = {
	code: string;
	moduleId: string;
	blocks: SfcLocaleBlock[];
	scriptMessages: Partial<Record<LocaleCode, LocaleDictionary>>;
};
