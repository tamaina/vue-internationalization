export type LocaleCode = string;
export type LocaleValue = string | number | boolean | null | LocaleDictionary | LocaleValue[];
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
};
