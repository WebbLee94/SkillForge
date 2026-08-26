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
  // E2E 构建钉版 zh-CN：CI 宿主 locale 为 en-US 时 navigator.language 检测
  // 会把界面渲染成英文，导致全部中文文案断言失败。生产构建不含此分支。
  if (import.meta.env.VITE_E2E === 'true') {
    return 'zh-CN';
  }
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    if (!stored || stored === 'system') {
      const browserLang = navigator.language || 'zh-CN';
      return browserLang.startsWith('zh') ? 'zh-CN' : 'en-US';
    }
    return stored;
  } catch {
    const browserLang = navigator.language || 'zh-CN';
    return browserLang.startsWith('zh') ? 'zh-CN' : 'en-US';
  }
}

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
  lng: resolveInitLanguage(),
  fallbackLng: 'en-US',
  defaultNS: 'common',
  ns: ['common', 'skills', 'rules', 'scenes', 'distribution', 'settings'],
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
