import colors from "colors/safe";
import * as i18n from "i18n";
import * as osLocale from "os-locale";
import * as path from "path";

import { Maybe } /* supplied by @types/embark in packages/embark-typings */ from "embark";

enum LocalType {
  Specified = "specified",
  Detected = "detected",
}

enum SupportedLanguage {
  En = "en",
  Pt = "pt",
  Fr = "fr",
  Es = "es",
}

const DEFAULT_LANGUAGE = SupportedLanguage.En;

const i18nEmbark = { __: () => {}};

i18n.configure({
  directory: path.join(__dirname, "../", "locales"),
  locales: Object.values(SupportedLanguage),
  register: i18nEmbark,
  syncFiles: false,
  updateFiles: false,
});

const isSupported = (locale: string) => {
  return Object.values(SupportedLanguage).includes(locale);
};

export const setOrDetectLocale = (locale: Maybe<string>) => {
  let how = LocalType.Specified;
  if (!locale) {
    how = LocalType.Detected;
    locale = osLocale.sync();
  }
  locale = locale.substr(0, 2);
  if (!isSupported(locale)) {
    console.warn(colors.yellow(`===== locale ${locale} ${how} but not supported, default: en =====`));
    return;
  }
  i18n.setLocale(locale);
};

i18n.setLocale(DEFAULT_LANGUAGE);

export const __ = i18nEmbark.__;