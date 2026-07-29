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

const LANG_STORAGE_KEY = 'skillforge-lang';

function resolveInitLanguage(): string {
  const stored = localStorage.getItem(LANG_STORAGE_KEY);
  if (!stored || stored === 'system') {
    const browserLang = navigator.language || 'zh-CN';
    return browserLang.startsWith('zh') ? 'zh-CN' : 'en-US';
  }
  return stored;
}

i18n.use(initReactI18next).init({
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
  lng: resolveInitLanguage(),
  fallbackLng: 'en-US',
  defaultNS: 'common',
  ns: ['common', 'skills', 'rules', 'scenes', 'distribution', 'settings'],
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
