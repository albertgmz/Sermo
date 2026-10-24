import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { messageBody } from "@/lib/test-bodies";
import { formattedTranslator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

// A conversation message drawn by `messageRows` (the rows added to an open conversation) from
// faked backend answers: the same `MessageItem` the page draws, which is a thread post's frame,
// body, footer and quick edit with the private rules of a conversation.

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: () => undefined,
    set: () => {},
    toString: () => "",
  }),
}));
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/conversations/5",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
// Another suite replaces the translator with one that fills no placeholders: use the real one.
const intl = { ...(await import("next-intl")) };
const { useTranslations } = await import("use-intl");
mock.module("next-intl", () => ({
  ...intl,
  useLocale: () => "en",
  useTranslations,
}));
const intlServer = { ...(await import("next-intl/server")) };
mock.module("next-intl/server", () => ({
  ...intlServer,
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => formattedTranslator(namespace),
}));
afterAll(() => {
  mock.module("next/navigation", () => navigation);
  mock.module("next-intl", () => intl);
  mock.module("next-intl/server", () => intlServer);
});
const { messageRows } = await import("./message-item");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const ember = { kind: "member", id: 3, username: "ember" };

function backend() {
  globalThis.fetch = (async (input: string) => {
    const path = new URL(input).pathname;
    if (path === "/api/v1/member-authors")
      return Response.json({
        items: [
          {
            card: {
              ...ember,
              avatar: null,
              frame: null,
              nameColor: null,
              nameIcon: null,
              title: "",
              badges: [],
              level: 1,
              restricted: false,
            },
            cover: null,
            createdAt: "2025-03-14T10:00:00.000Z",
            postCount: 3,
            reactionScore: 0,
            awardXp: 0,
            currentLevelXp: 0,
            nextLevelXp: 100,
            awards: [],
            signatureHtml: null,
            lastActivityAt: null,
            lastActivityHidden: false,
          },
        ],
      });
    if (path === "/api/v1/reaction-types") return Response.json({ items: [] });
    if (path === "/api/v1/me") return Response.json(viewerBody(true));
    return Response.json(
      { error: { code: "not_found", message: path } },
      { status: 404 },
    );
  }) as unknown as typeof fetch;
}

async function drawn(over: Record<string, unknown>) {
  backend();
  const [row] = await messageRows([
    messageBody({
      author: ember,
      bodyHtml: "<p>hi</p>",
      ...over,
    }) as Parameters<typeof messageRows>[0][number],
  ]);
  const stream = await renderToReadableStream(withIntl(row.node));
  await stream.allReady;
  return new Response(stream).text();
}

const has = (html: string, label: string) =>
  html.includes(`aria-label="${label}"`);

test("a message has a thread post's footer: report, then + Quote and Reply, and no share or post number", async () => {
  const html = await drawn({});
  expect(has(html, "Report")).toBe(true);
  expect(html).toContain("+ Quote");
  expect(html).toContain('href="#reply"');
  // A private message has no permalink to hand out and no place in a public numbering.
  expect(has(html, "Share")).toBe(false);
  expect(has(html, "Bookmark")).toBe(false);
  expect(html).not.toMatch(/>#\d+</);
});

test("its text is quotable by selection as a conversation message, with the author's attribution", async () => {
  const html = await drawn({});
  expect(html).toContain('data-quote-ref="convMessage"');
  expect(html).toContain('data-quote-id="11"');
  expect(html).toContain('data-quote-author="ember"');
});

test("a message a deleted member left is the guest word, with no link to a profile", async () => {
  const html = await drawn({ author: { kind: "guest", name: null } });
  expect(html).toContain(">Guest<");
  expect(html).not.toContain('href="/members/');
  expect(html).toContain('data-quote-author=""');
});

test("a message its viewer may edit has Edit, whose address is the message's edit page", async () => {
  const html = await drawn({ canEdit: true });
  expect(has(html, "Edit")).toBe(true);
  expect(html).toContain('href="/conversations/5/edit/11"');
  // The text is drawn as a post's body, with its spoilers and files read as a message's.
  expect(html).toContain("<p>hi</p>");
});

test("a message that is not visible is not quotable", async () => {
  for (const state of ["moderated", "deleted"]) {
    const html = await drawn({ state });
    expect(html).not.toContain("data-quote-ref");
    expect(html).not.toContain("+ Quote");
  }
});

test("a deleted message is folded to its notice, as a thread's post, with Delete permanently for those allowed", async () => {
  const folded = await drawn({ state: "deleted", canHardDelete: true });
  expect(folded).not.toContain("<p>hi</p>");
  expect(folded).toContain('id="message-11"');
  expect(folded).toContain("This message was deleted.");
  expect(folded).toMatch(/aria-expanded="false"[^>]*>Show…</);
  expect(has(folded, "Delete permanently")).toBe(true);

  const plain = await drawn({ state: "deleted" });
  expect(has(plain, "Delete permanently")).toBe(false);
  expect(plain).toContain("Show…");
});

test("a deleted message names who deleted it, when and why, for the staff the backend tells", async () => {
  const html = await drawn({
    state: "deleted",
    deletion: {
      by: { id: 4, username: "nova" },
      reason: "Spam",
      at: "2026-01-02T00:00:00.000Z",
    },
  });
  expect(html).toContain("Deleted by nova");
  expect(html).toContain("Reason: Spam");
  expect(html).toContain('dateTime="2026-01-02T00:00:00.000Z"');
  expect(html).not.toContain("This message was deleted.");
});
