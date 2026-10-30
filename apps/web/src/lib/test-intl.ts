import { createElement, Fragment, type ReactNode } from "react";
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
  // The tags the values name as functions are drawn in place (`<time></time>`, `<b>text</b>`);
  // any other text stays as written.
  const rich = (
    key: string,
    values?: Record<string, string | number | ((chunks: string) => ReactNode)>,
  ) => {
    const text = t(key, values as Record<string, string | number>);
    const drawn = Object.entries(values ?? {}).some(
      ([, value]) => typeof value === "function",
    );
    if (!drawn) return text;
    const parts = text.split(/(<\w+>.*?<\/\w+>)/g).map((part) => {
      const tag = /^<(\w+)>(.*?)<\/\1>$/.exec(part);
      const draw = tag ? values?.[tag[1]] : undefined;
      return typeof draw === "function" ? draw(tag?.[2] ?? "") : part;
    });
    return createElement(Fragment, null, ...parts);
  };
  return Object.assign(t, { rich, has });
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

// The clock of a test that draws a past moment: the same for `getNow` and for the provider.
export const TEST_NOW = new Date("2026-10-21T12:00:00.000Z");

// Client components read their text from a provider; this one serves the same message files.
export function withIntl(children: ReactNode) {
  return createElement(IntlProvider, {
    locale: "en",
    messages,
    timeZone: "UTC",
    now: TEST_NOW,
    children,
  });
}
