import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSettingsStore, type AppSettings } from "../settings/settingsStore";
import { en, fr, type MessageKey } from "./messages";

export type SupportedLanguage = "fr" | "en";
export type TranslationValues = Record<string, string | number>;
export type Translate = (key: MessageKey, values?: TranslationValues) => string;

const dictionaries = { fr, en } satisfies Record<SupportedLanguage, Record<MessageKey, string>>;

export function resolveLanguage(
  preference: AppSettings["language"],
  systemLanguages: readonly string[] = typeof navigator === "undefined" ? [] : navigator.languages,
): SupportedLanguage {
  if (preference !== "system") return preference;
  for (const candidate of systemLanguages) {
    const language = candidate.trim().toLocaleLowerCase().split("-")[0];
    if (language === "fr" || language === "en") return language;
  }
  return "en";
}

export function translate(
  language: SupportedLanguage,
  key: MessageKey,
  values: TranslationValues = {},
): string {
  return dictionaries[language][key].replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder,
  );
}

type I18nContextValue = {
  language: SupportedLanguage;
  locale: "fr-FR" | "en-US";
  t: Translate;
};

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

function readSystemLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages.length > 0 ? [...navigator.languages] : [navigator.language];
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const preference = useSettingsStore((state) => state.language);
  const [systemLanguages, setSystemLanguages] = useState(readSystemLanguages);
  const language = resolveLanguage(preference, systemLanguages);
  const t = useCallback<Translate>((key, values) => translate(language, key, values), [language]);
  const value = useMemo<I18nContextValue>(
    () => ({ language, locale: language === "fr" ? "fr-FR" : "en-US", t }),
    [language, t],
  );

  useEffect(() => {
    const update = () => setSystemLanguages(readSystemLanguages());
    window.addEventListener("languagechange", update);
    return () => window.removeEventListener("languagechange", update);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return createElement(I18nContext.Provider, { value }, children);
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}
