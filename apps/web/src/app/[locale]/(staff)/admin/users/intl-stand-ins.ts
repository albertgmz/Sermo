import { mock } from "bun:test";
import { TEST_NOW, translator } from "@/lib/test-intl";

// What the panel's list and form tests read their words through: the message files served by the
// library's own hook (for the client components, whatever stand-in another suite of the run left
// behind for `next-intl`) and by `getTranslations` (for the server ones). Call it before importing
// the code under test and call the function it returns in `afterAll`.
export async function installIntl() {
  const nextIntl = await import("next-intl");
  const server = await import("next-intl/server");
  const useIntl = await import("use-intl");
  mock.module("next-intl", () => ({
    ...nextIntl,
    useLocale: () => "en",
    useTranslations: useIntl.useTranslations,
  }));
  mock.module("next-intl/server", () => ({
    getLocale: async () => "en",
    getNow: async () => TEST_NOW,
    getTranslations: async (namespace: string) => translator(namespace, true),
    getFormatter: async () => ({
      dateTime: (date: Date) => date.toISOString().slice(0, 10),
      number: (value: number) => String(value),
    }),
  }));
  return () => {
    mock.module("next-intl", () => nextIntl);
    mock.module("next-intl/server", () => server);
  };
}
