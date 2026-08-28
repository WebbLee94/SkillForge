import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import commonZh from '../locales/zh-CN/common.json';
import skillsZh from '../locales/zh-CN/skills.json';
import rulesZh from '../locales/zh-CN/rules.json';
import scenesZh from '../locales/zh-CN/scenes.json';
import distributionZh from '../locales/zh-CN/distribution.json';
import settingsZh from '../locales/zh-CN/settings.json';

import commonEn from '../locales/en-US/common.json';
import skillsEn from '../locales/en-US/skills.json';
import rulesEn from '../locales/en-US/rules.json';
import scenesEn from '../locales/en-US/scenes.json';
import distributionEn from '../locales/en-US/distribution.json';
import settingsEn from '../locales/en-US/settings.json';

import { ipc } from './ipc';

const LANG_STORAGE_KEY = 'skillforge-lang';

function normalizeLanguageTag(language: string | null | undefined): string {
  const lowered = (language ?? '').trim().toLowerCase();
  if (lowered.startsWith('zh')) return 'zh-CN';
  return 'en-US';
}

function getStoredLanguage(): string | null {
  try {
    return localStorage.getItem(LANG_STORAGE_KEY);
  } catch {
    return null;
  }
}

function getBrowserLanguage(): string | null {
  const languages = navigator.languages;
  if (Array.isArray(languages) && languages.length > 0) {
    return languages[0] ?? null;
  }

  return navigator.language ?? null;
}

export async function resolveSystemLanguage(): Promise<string> {
  const stored = getStoredLanguage();
  if (stored && stored !== 'system') {
    return normalizeLanguageTag(stored);
  }

  const browserLanguage = getBrowserLanguage();
  if (browserLanguage) {
    return normalizeLanguageTag(browserLanguage);
  }

  try {
    const systemLocale = await ipc.getSystemLocale();
    return normalizeLanguageTag(systemLocale);
  } catch {
    return normalizeLanguageTag(browserLanguage);
  }
}

function configureI18n() {
  if (i18n.isInitialized) return i18n;

  i18n.use(initReactI18next);
  i18n.init({
    resources: {
      'zh-CN': {
        common: commonZh,
        skills: skillsZh,
        rules: rulesZh,
        scenes: scenesZh,
        distribution: distributionZh,
        settings: settingsZh,
      },
      'en-US': {
        common: commonEn,
        skills: skillsEn,
        rules: rulesEn,
        scenes: scenesEn,
        distribution: distributionEn,
        settings: settingsEn,
      },
    },
    lng: 'zh-CN',
    fallbackLng: 'en-US',
    defaultNS: 'common',
    ns: ['common', 'skills', 'rules', 'scenes', 'distribution', 'settings'],
    interpolation: {
      escapeValue: false,
    },
  });

  return i18n;
}

configureI18n();

export async function initI18n() {
  const stored = getStoredLanguage();
  if (stored && stored !== 'system') {
    const normalized = normalizeLanguageTag(stored);
    if (i18n.language !== normalized) {
      await i18n.changeLanguage(normalized);
    }
    return i18n;
  }

  const resolved = await resolveSystemLanguage();
  if (i18n.language !== resolved) {
    await i18n.changeLanguage(resolved);
  }
  return i18n;
}

export function getSystemLanguageForSettings() {
  return resolveSystemLanguage();
}

export default i18n;
