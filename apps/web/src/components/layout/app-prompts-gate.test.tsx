import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { fakeBackend } from "@/app/[locale]/(staff)/admin/groups/test-backend";
import { siteBody } from "@/lib/test-bodies";
import { translator } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

// What floats over a page for whom: a member keeps the app and notification cards; a guest is not
// offered the app any more (only the browser's subscription is checked) and is invited to create
// an account instead, where registration is open.

mock.module("server-only", () => ({}));
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
afterAll(() => mock.module("next-intl/server", () => intl));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const { LazyAppPrompts, LazySignupNudges } = await import(
  "@/components/layout/app-prompts-lazy"
);
const { AppPromptsGate } = await import("@/components/layout/app-prompts-gate");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());

async function drawn(signedIn: boolean, registrationOpen = true) {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(signedIn)),
    "site.get": () =>
      Response.json(
        siteBody({
          registration: {
            open: registrationOpen,
            approval: false,
            minimumAge: 0,
            fields: [],
          },
        }),
      ),
    "push.publicKey": () => Response.json({ publicKey: null }),
  });
  const tree = (await AppPromptsGate()) as ReactElement<{
    children: ReactNode;
  }>;
  const parts = [tree.props.children]
    .flat()
    .filter((part): part is ReactElement<Record<string, unknown>> =>
      isValidElement(part),
    );
  return {
    prompts: parts.find((part) => part.type === LazyAppPrompts)?.props,
    nudges: parts.some((part) => part.type === LazySignupNudges),
  };
}

test("a member keeps the app and notification cards and is never invited to sign up", async () => {
  const { prompts, nudges } = await drawn(true);
  expect(prompts?.offers).toBe(true);
  expect(prompts?.member).toMatchObject({ id: "1" });
  expect(nudges).toBe(false);
});

test("a guest gets no install card, still has the subscription checked, and is invited to sign up", async () => {
  const { prompts, nudges } = await drawn(false);
  expect(prompts?.offers).toBe(false);
  expect(prompts?.member).toBeNull();
  expect(nudges).toBe(true);
});

test("a guest is not invited where registration is closed", async () => {
  const { prompts, nudges } = await drawn(false, false);
  expect(prompts?.offers).toBe(false);
  expect(nudges).toBe(false);
});
