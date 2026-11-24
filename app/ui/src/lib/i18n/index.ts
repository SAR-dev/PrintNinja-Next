/**
 * i18next bootstrap and the language mechanism.
 *
 * The language is remembered in localStorage (key printninja.language),
 * falls back to the browser's first supported language, then to English.
 * setLanguage persists the choice and switches the interface at once;
 * syncDocumentLanguage keeps <html lang> in step for a11y.
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en";
import ja from "./locales/ja";

export const SUPPORTED_LANGUAGES = ["en", "ja"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

const STORAGE_KEY = "printninja.language";

const resources = {
  en: { translation: en },
  ja: { translation: ja },
};

function isSupported(lng: string): lng is Language {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(lng);
}

/** The remembered choice, else the browser's first supported language, else "en". */
export function detectLanguage(): Language {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && isSupported(stored)) return stored;
  } catch {
    // No localStorage (private mode, webview quirks) — fall through.
  }
  for (const lng of navigator.languages ?? [navigator.language]) {
    const base = lng.split("-")[0];
    if (isSupported(base)) return base;
  }
  return "en";
}

/** Persist the choice and switch the interface to it. */
export function setLanguage(lng: Language): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    // Remembering failed; the switch below still applies for this session.
  }
  void i18n.changeLanguage(lng);
}

/** Keep <html lang> matching the interface language (BCP-47 base). */
export function syncDocumentLanguage(lng: string): void {
  document.documentElement.lang = lng.split("-")[0];
}

const initial = detectLanguage();

i18n.use(initReactI18next).init({
  resources,
  lng: initial,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

syncDocumentLanguage(initial);
i18n.on("languageChanged", syncDocumentLanguage);

export default i18n;
