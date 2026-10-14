import { afterAll, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { messages } from "@/i18n/messages";

const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getTranslations: async (namespace: string) => (key: string) => {
    let value: unknown = messages;
    for (const part of `${namespace}.${key}`.split(".")) {
      value = (value as Record<string, unknown> | undefined)?.[part];
    }
    return typeof value === "string" ? value : key;
  },
}));
mock.module("server-only", () => ({}));
mock.module("@/app/[locale]/(auth)/auth-shell", () => ({
  AuthShell: ({
    heading,
    children,
  }: {
    heading: string;
    children: React.ReactNode;
  }) =>
    createElement("main", null, createElement("h1", null, heading), children),
}));
mock.module("@/app/[locale]/(auth)/resend-form", () => ({
  ResendForm: () => null,
}));
let viewer: { user: { email: string } | null } = { user: null };
mock.module("@/lib/sermo/session", () => ({ getViewer: async () => viewer }));
let account: { emailVerified: boolean } | null = null;
mock.module("@/lib/sermo/auth", () => ({
  getCurrentAccount: async () => account,
}));

const { default: VerifyEmailPage } = await import("./page");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

async function html(search: Record<string, string>) {
  return renderToStaticMarkup(
    await VerifyEmailPage({
      searchParams: Promise.resolve(search),
    } as never),
  );
}

test("anyone who types ?done=1 is not told their address is confirmed", async () => {
  viewer = { user: null };
  const page = await html({ done: "1" });
  expect(page).not.toContain(messages.auth.verifyEmail.success);
  expect(page).not.toContain(messages.auth.verifyEmail.successHeading);
  expect(page).toContain(messages.auth.verifyEmail.done);
});

test("a member whose address is not confirmed is not told it is either", async () => {
  viewer = { user: { email: "ann@example.test" } };
  account = { emailVerified: false };
  expect(await html({ done: "1" })).not.toContain(
    messages.auth.verifyEmail.success,
  );
});

test("a member whose account says the address is confirmed is told so", async () => {
  viewer = { user: { email: "ann@example.test" } };
  account = { emailVerified: true };
  expect(await html({ done: "1" })).toContain(
    messages.auth.verifyEmail.success,
  );
});
