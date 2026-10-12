import { getRequestConfig } from "next-intl/server";
import { messages } from "@/i18n/messages";

export const locale = "en";

// The locale is fixed, so nothing here reads the request and pages keep their
// prerendered shell. Do not add `now`: reading the clock here would run during
// prerendering.
export default getRequestConfig(async () => ({
  locale,
  messages,
  timeZone: "UTC",
}));
