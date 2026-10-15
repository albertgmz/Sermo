import { createElement, type ReactNode } from "react";
import { createTranslator, IntlProvider } from "use-intl";
import { messages } from "@/i18n/messages";

// What `getTranslations(namespace)` gives in a test: the message as written in the messages files,
// with its placeholders filled from the values only when `interpolate` is set.
export function translator(namespace: string, interpolate = false) {
  const t = (key: string, values?: Record<string, string | number>) => {
    let value: unknown = messages;
    for (const part of `${namespace}.${key}`.split(".")) {
      value = (value as Record<string, unknown> | undefined)?.[part];
    }
    if (typeof value !== "string") return key;
    if (!interpolate) return value;
    return value.replace(/\{(\w+)\}/g, (whole, name: string) =>
      values && name in values ? String(values[name]) : whole,
    );
  };
  const has = (key: string) => {
    let value: unknown = messages;
    for (const part of `${namespace}.${key}`.split(".")) {
      value = (value as Record<string, unknown> | undefined)?.[part];
    }
    return typeof value === "string";
  };
  return Object.assign(t, { rich: t, has });
}

// What `getTranslations(namespace)` gives in a test that needs the message formatted as the app
// does: plurals and selects resolved, placeholders filled.
export function formattedTranslator(namespace: string) {
  return createTranslator({
    locale: "en",
    messages,
    namespace: namespace as never,
  });
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
