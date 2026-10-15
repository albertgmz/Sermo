import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { translator } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
const actions = await import("@/app/[locale]/(main)/actions");
mock.module("@/app/[locale]/(main)/actions", () => ({
  acceptTerms: async () => ({}),
}));
// The form needs the app router; a marker shows what it was given.
const form = await import("@/components/forum/action-form");
mock.module("@/components/forum/action-form", () => ({
  ActionForm: (props: { submit: string; children: React.ReactNode }) => (
    <form data-submit={props.submit}>{props.children}</form>
  ),
}));

const { AcceptancePrompt, AcceptanceStrip } = await import(
  "./acceptance-prompt"
);

afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("@/app/[locale]/(main)/actions", () => actions);
  mock.module("@/components/forum/action-form", () => form);
});

function viewer(pendingAcceptance: { kind: string; version: number }[] | null) {
  globalThis.fetch = (async () =>
    Response.json(
      pendingAcceptance === null
        ? viewerBody(false)
        : {
            ...viewerBody(true),
            user: { ...viewerBody(true).user, pendingAcceptance },
          },
    )) as unknown as typeof fetch;
}

async function draw() {
  const prompt = (await AcceptancePrompt()) as {
    props: Parameters<typeof AcceptanceStrip>[0];
  } | null;
  return prompt
    ? renderToStaticMarkup(await AcceptanceStrip(prompt.props))
    : "";
}

test("a member with both pages pending gets a link to each and one button carrying the versions", async () => {
  viewer([
    { kind: "terms", version: 3 },
    { kind: "rules", version: 2 },
  ]);
  const markup = await draw();
  expect(markup).toContain('href="/terms"');
  expect(markup).toContain('href="/rules"');
  expect(markup).toContain('data-submit="I accept"');
  expect(markup).toContain('value="terms:3"');
  expect(markup).toContain('value="rules:2"');
  expect(markup.match(/<form/g)).toHaveLength(1);
  // Both themes: the links take the accent text colour that is readable in each.
  expect(markup).toContain("text-primary-ink");
  expect(markup).not.toContain("text-primary ");
});

test("only the page that is pending is linked", async () => {
  viewer([{ kind: "rules", version: 2 }]);
  const markup = await draw();
  expect(markup).toContain('href="/rules"');
  expect(markup).not.toContain('href="/terms"');
});

test("nothing pending, or a guest, draws nothing", async () => {
  viewer([]);
  expect(await AcceptancePrompt()).toBeNull();
  viewer(null);
  expect(await AcceptancePrompt()).toBeNull();
});
