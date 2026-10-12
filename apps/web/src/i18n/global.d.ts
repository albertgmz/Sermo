import type { messages } from "@/i18n/messages";
import type { locale } from "@/i18n/request";

declare module "next-intl" {
  interface AppConfig {
    Locale: typeof locale;
    Messages: typeof messages;
  }
}
