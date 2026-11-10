import { en } from './en';
import { pl } from './pl';
import { Strings, uk } from './uk';

export type Lang = 'uk' | 'en' | 'pl';

/** Названия языков на них самих: так человек узнает свой язык в любом интерфейсе. */
export const LANGUAGES: Record<Lang, string> = { uk: 'Українська', en: 'English', pl: 'Polski' };

const dictionaries: Record<Lang, Strings> = { uk, en, pl };
const STORAGE_KEY = 'lang';

/** Сохранённый выбор, иначе язык телефона, иначе English. Русская локаль — украинский: приложение для семей из Украины. */
function pick(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved in dictionaries) return saved as Lang;
  } catch {
    // приватный режим: выбор не сохраняется, берём язык телефона
  }
  for (const tag of navigator.languages ?? [navigator.language]) {
    const code = tag.slice(0, 2).toLowerCase();
    if (code in dictionaries) return code as Lang;
    if (code === 'ru') return 'uk';
  }
  return 'en';
}

export const lang: Lang = pick();
export const i18n: Strings = dictionaries[lang];
document.documentElement.lang = lang;

/** Строки берутся при создании экранов, поэтому язык меняем перезагрузкой: так обновятся все экраны сразу. */
export function setLang(next: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    return; // без хранилища выбор не переживёт перезагрузку
  }
  location.reload();
}
