import { mock } from "bun:test";
import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { formattedTranslator, withIntl } from "@/lib/test-intl";

// What the page tests of the Economy section share: the words the server components and the
// client components read, and the render of one of them to text.
//
// `mockIntl` serves `getTranslations` and `getFormatter` from the message files and gives the
// client components the library's own `useTranslations` (whatever stand-in another suite left in
// place), and returns what puts the modules back; call it in `afterAll`.
export async function mockIntl() {
  const server = await import("next-intl/server");
  const client = await import("next-intl");
  const useIntl = await import("use-intl");
  mock.module("server-only", () => ({}));
  mock.module("next/headers", () => ({
    headers: async () => new Headers(),
    cookies: async () => ({ get: () => undefined, toString: () => "" }),
  }));
  mock.module("next-intl", () => ({
    ...client,
    useLocale: () => "en",
    useTranslations: useIntl.useTranslations,
  }));
  mock.module("next-intl/server", () => ({
    getLocale: async () => "en",
    getTranslations: async (namespace: string) =>
      formattedTranslator(namespace),
    getFormatter: async () => ({
      number: (value: number, options?: Intl.NumberFormatOptions) =>
        new Intl.NumberFormat("en", options).format(value),
      dateTime: (value: Date, options?: Intl.DateTimeFormatOptions) =>
        new Intl.DateTimeFormat("en", { timeZone: "UTC", ...options }).format(
          value,
        ),
    }),
  }));
  return () => {
    mock.module("next-intl/server", () => server);
    mock.module("next-intl", () => client);
  };
}

export async function htmlOf(node: ReactNode) {
  const stream = await renderToReadableStream(withIntl(node));
  await stream.allReady;
  return new Response(stream).text();
}

// The address a redirect went to, or undefined when `run` did not redirect.
export async function redirectedTo(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    return String((error as { digest?: unknown }).digest);
  }
  return undefined;
}
