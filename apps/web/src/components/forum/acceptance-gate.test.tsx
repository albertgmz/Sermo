import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { siteBody } from "@/lib/test-bodies";
import { formattedTranslator } from "@/lib/test-intl";
import { textOfTree } from "@/lib/test-tree";
import { viewerBody } from "@/lib/test-viewer";

let cookie = "";
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(cookie ? { cookie } : {}),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => formattedTranslator(namespace),
}));
const { AcceptanceGate, pendingOf } = await import("./acceptance-gate");
const { acceptTerms } = await import("@/app/[locale]/(main)/actions");
const { SignOutForm } = await import("@/components/layout/sign-out-form");
const { LogoMark } = await import("@/components/layout/logo");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  cookie = "";
});
afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/cache", () => nextCache);
});

const page = (slug: string, title: string, bodyHtml: string) => ({
  slug,
  title,
  bodyHtml,
  isPublished: true,
  version: 3,
  updatedAt: "2026-10-01T10:00:00.000Z",
});

// The backend as a member (or a guest) with these pages pending; returns the paths asked.
function backend(
  pendingAcceptance: { kind: string; version: number }[] | null,
) {
  const asked: string[] = [];
  globalThis.fetch = (async (input: string) => {
    const path = new URL(input).pathname;
    asked.push(path);
    if (path === "/api/v1/site") return Response.json(siteBody());
    if (path === "/api/v1/pages/terms")
      return Response.json(page("terms", "Terms of use", "<p>Be kind.</p>"));
    if (path === "/api/v1/pages/rules")
      return Response.json(page("rules", "Forum rules", "<p>No spam.</p>"));
    return Response.json(
      pendingAcceptance === null
        ? viewerBody(false)
        : {
            ...viewerBody(true),
            user: { ...viewerBody(true).user, pendingAcceptance },
          },
    );
  }) as unknown as typeof fetch;
  return asked;
}

const requested = <p>The requested thread</p>;
const gate = () => AcceptanceGate({ children: requested });
// The forms' client components are not called: they need the app router.
const textOf = async (node: unknown) =>
  textOfTree(node, ["HtmlContent", "ActionForm", "Button"]);

type Drawn = { type?: unknown; props?: Record<string, unknown> };

// The elements of a drawn tree that match, without calling any component (the forms are client
// components and need the app router).
function elementsOf(
  node: unknown,
  match: (element: Drawn) => boolean,
): Drawn[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node))
    return node.flatMap((child) => elementsOf(child, match));
  const element = node as Drawn;
  return [
    ...(match(element) ? [element] : []),
    ...elementsOf(element.props?.children, match),
  ];
}

// The screen the gate draws, one level down: its own elements, its components not called.
async function screenOf() {
  const gate = (await AcceptanceGate({ children: requested })) as Drawn;
  const [screen] = elementsOf(
    gate.props?.children,
    (element) => typeof element.type === "function",
  );
  if (!screen) throw new Error("The gate drew no screen");
  return (screen.type as (props: unknown) => Promise<unknown>)(screen.props);
}

// The accept form's action, label and the `kind:version` it sends; and the log out form's action.
function forms(screen: unknown) {
  const [accept] = elementsOf(
    screen,
    (element) => "submit" in (element.props ?? {}),
  );
  const sent = elementsOf(
    accept?.props?.children,
    (element) => element.props?.name === "accept",
  );
  const [out] = elementsOf(screen, (element) => element.type === SignOutForm);
  return {
    action: accept?.props?.action,
    submit: accept?.props?.submit,
    sent: sent.map((input) => input.props?.value),
    logout: out !== undefined,
  };
}

test("a member with both pages pending gets the gate with their text, the button and log out, and nothing of the page", async () => {
  cookie = "sermo.session_token=abc";
  backend([
    { kind: "terms", version: 3 },
    { kind: "rules", version: 2 },
  ]);
  const drawn = await gate();
  expect(drawn).not.toBe(requested);
  const text = await textOf(drawn);
  expect(text).toContain("Please accept the terms and rules");
  expect(text).toContain("Garden Club");
  expect(text).toContain("Terms of use");
  expect(text).toContain("[HtmlContent <p>Be kind.</p>]");
  expect(text).toContain("Forum rules");
  expect(text).toContain("[HtmlContent <p>No spam.</p>]");
  expect(text).toContain("Log out");
  expect(text).not.toContain("The requested thread");
  // The header, notices, footer and bottom bar go too.
  expect(text).toContain(
    "[data-forum-layout]>:not([data-forum-body]),[data-forum-body]>:not(main){display:none}",
  );
});

test("the forum layout draws every page through the gate, in the main element the gate keeps", () => {
  const layout = readFileSync(
    join(import.meta.dir, "../../app/[locale]/(main)/layout.tsx"),
    "utf8",
  );
  expect(layout).toContain("data-forum-layout=");
  expect(layout).toMatch(
    /<div\s+data-forum-body=""[^>]*>\s*<PageBackdrop \/>[\s\S]*?<main[^>]*>\s*(\{\/\*[\s\S]*?\*\/\}\s*)?<Suspense>\s*<AcceptanceGate>\{children\}<\/AcceptanceGate>\s*<\/Suspense>\s*<\/main>/,
  );
  expect(layout.match(/\{children\}/g)).toHaveLength(1);
});

test("only the page that is pending is shown and accepted", async () => {
  cookie = "sermo.session_token=abc";
  const asked = backend([{ kind: "rules", version: 2 }]);
  const text = await textOf(await gate());
  expect(text).toContain("Please accept the rules");
  expect(text).toContain("Forum rules");
  expect(text).not.toContain("Terms of use");
  expect(asked).not.toContain("/api/v1/pages/terms");
});

test("the gate's one button accepts the versions it shows, and log out signs the member out", async () => {
  cookie = "sermo.session_token=abc";
  backend([
    { kind: "terms", version: 3 },
    { kind: "rules", version: 2 },
  ]);
  expect(forms(await screenOf())).toEqual({
    action: acceptTerms,
    submit: "I accept",
    sent: ["terms:3", "rules:2"],
    logout: true,
  });
  backend([{ kind: "rules", version: 2 }]);
  expect(forms(await screenOf()).sent).toEqual(["rules:2"]);
});

test("a member with nothing pending gets the page, with no request beyond who they are", async () => {
  cookie = "sermo.session_token=abc";
  const asked = backend([]);
  expect(await gate()).toBe(requested);
  expect(asked).toHaveLength(1);
});

test("a guest gets the page without the gate waiting for anything", async () => {
  const asked = backend(null);
  expect(await gate()).toBe(requested);
  expect(asked).toEqual([]);
});

test("a viewer from a backend without the field has nothing pending", () => {
  expect(pendingOf({})).toEqual([]);
  expect(pendingOf(null)).toEqual([]);
  expect(
    pendingOf({ pendingAcceptance: [{ kind: "terms", version: 1 }] }),
  ).toHaveLength(1);
});

test("the site's mark is hidden from screen readers, since its name is written beside it", async () => {
  cookie = "sermo.session_token=abc";
  backend([{ kind: "terms", version: 3 }]);
  const drawn = await screenOf();
  const [holder] = elementsOf(
    drawn,
    (element) =>
      elementsOf(element.props?.children, (child) => child.type === LogoMark)
        .length > 0 && element.type === "span",
  );
  expect(holder?.props?.["aria-hidden"]).toBe("true");
  expect(await textOf(drawn)).toContain("Garden Club");
});
