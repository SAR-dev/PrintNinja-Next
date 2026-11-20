import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// Minimal i18n bootstrap for the design-system port: the ported
// password-input.tsx calls useTranslation() for its two visibility labels.
// The full locale files land with the screens.
const resources = {
  en: {
    translation: {
      auth: {
        show_password: "Show password",
        hide_password: "Hide password",
      },
    },
  },
};

i18n.use(initReactI18next).init({
  resources,
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
