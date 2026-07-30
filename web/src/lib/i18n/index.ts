"use client";

import i18n from "i18next";
import { initReactI18next } from "react-i18next";

/**
 * Minimal, non-blocking i18next setup with an inline `en` resource. Kept tiny
 * on purpose; expand resources/namespaces as the app grows.
 */
export const resources = {
  en: {
    translation: {
      app: {
        title: "Cubes",
        tagline: "Cubes — coming together",
      },
      nav: {
        home: "Home",
        projects: "Projects",
        schedule: "Schedule",
        reporting: "Reporting",
      },
    },
  },
} as const;

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: "en",
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
}

export default i18n;
