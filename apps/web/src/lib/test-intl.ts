import { createElement, type ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { messages } from "@/i18n/messages";

// What `getTranslations(namespace)` gives in a test: the message as written in the messages files.
export function translator(namespace: string) {
  const t = (key: string) => {
    let value: unknown = messages;
    for (const part of `${namespace}.${key}`.split(".")) {
      value = (value as Record<string, unknown> | undefined)?.[part];
    }
    return typeof value === "string" ? value : key;
  };
  return Object.assign(t, { rich: t });
}

// Client components read their text from a provider; this one serves the same message files.
export function withIntl(children: ReactNode) {
  return createElement(IntlProvider, {
    locale: "en",
    messages,
    timeZone: "UTC",
    children,
  });
}
