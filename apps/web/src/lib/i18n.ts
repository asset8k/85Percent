/**
 * i18n — internationalization bootstrap for the web app.
 *
 * Imported once for its side effects (see `main.tsx`), this initializes a single
 * global i18next instance that `useTranslation()` reads from anywhere in the
 * tree — no <I18nextProvider> wrapper required, since react-i18next falls back
 * to this default instance.
 *
 * Supported UI languages: English (en, fallback), Spanish (es), French (fr),
 * Italian (it). The user's choice is persisted to localStorage under
 * `LANGUAGE_STORAGE_KEY` so it survives reloads; we read it back here on boot.
 *
 * NOTE: this controls *interface* language only. Monetary values stay formatted
 * by the workspace's base currency (see `useWorkspaceCurrency`) and are never
 * translated. Locale-aware date/number helpers live in `lib/locale.ts`.
 */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from '@/locales/en/translation.json'
import es from '@/locales/es/translation.json'
import fr from '@/locales/fr/translation.json'
import it from '@/locales/it/translation.json'

/** BCP-47 codes for every interface language we ship. `en` is the fallback. */
export const SUPPORTED_LANGUAGES = ['en', 'es', 'fr', 'it'] as const
export type Language = (typeof SUPPORTED_LANGUAGES)[number]

/** Native-name labels for the language picker in Settings. */
export const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  it: 'Italiano',
}

/** ISO 3166-1 alpha-2 country code used for each language's flag in the picker. */
export const LANGUAGE_FLAGS: Record<Language, string> = {
  en: 'GB',
  es: 'ES',
  fr: 'FR',
  it: 'IT',
}

/** localStorage key holding the user's chosen interface language. */
export const LANGUAGE_STORAGE_KEY = 'headroom-language'

function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    if (saved && (SUPPORTED_LANGUAGES as readonly string[]).includes(saved)) {
      return saved as Language
    }
  } catch {
    // localStorage unavailable (private mode / SSR) — fall through to default.
  }
  return 'en'
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
    fr: { translation: fr },
    it: { translation: it },
  },
  lng: initialLanguage(),
  fallbackLng: 'en',
  supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
  interpolation: {
    // React already escapes values, so i18next doesn't need to.
    escapeValue: false,
  },
})

/**
 * Change the active interface language and persist the choice. Components should
 * call this (rather than `i18n.changeLanguage` directly) so the localStorage
 * write stays colocated with the language switch.
 */
export function setLanguage(lng: Language): void {
  i18n.changeLanguage(lng)
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lng)
  } catch {
    // Best-effort persistence; the in-memory switch still applies this session.
  }
}

export default i18n
