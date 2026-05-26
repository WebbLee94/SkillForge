import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import commonZh from "../locales/zh-CN/common.json";
import skillsZh from "../locales/zh-CN/skills.json";
import rulesZh from "../locales/zh-CN/rules.json";
import scenesZh from "../locales/zh-CN/scenes.json";
import distributionZh from "../locales/zh-CN/distribution.json";

import commonEn from "../locales/en-US/common.json";
import skillsEn from "../locales/en-US/skills.json";
import rulesEn from "../locales/en-US/rules.json";
import scenesEn from "../locales/en-US/scenes.json";
import distributionEn from "../locales/en-US/distribution.json";

i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": {
      common: commonZh,
      skills: skillsZh,
      rules: rulesZh,
      scenes: scenesZh,
      distribution: distributionZh,
    },
    "en-US": {
      common: commonEn,
      skills: skillsEn,
      rules: rulesEn,
      scenes: scenesEn,
      distribution: distributionEn,
    },
  },
  lng: "zh-CN",
  fallbackLng: "en-US",
  defaultNS: "common",
  ns: ["common", "skills", "rules", "scenes", "distribution"],
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
