import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));
const intlServer = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  ...intlServer,
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const navigation = { ...(await import("next/navigation")) };
mock.module("next/navigation", () => ({
  ...navigation,
  useRouter: () => ({ push() {}, refresh() {} }),
}));
// The "•••" menu's popup is code for a press: the page draws its plain button, and what the menu
// would offer is what the toolbar hands the popup.
type Menu = { entries: { id: string; label: string }[] };
let menu: Menu | undefined;
// What the last toolbar drawn handed its menu (read through a call: TypeScript would narrow `menu`).
const offered = () => menu?.entries;
const realPopup = { ...(await import("@/components/ui/lazy-popup")) };
mock.module("@/components/ui/lazy-popup", () => ({
  ...realPopup,
  LazyPopup: (props: {
    popup: unknown;
    trigger: (lazy: object) => React.ReactElement;
  }) => {
    if ((props.popup as { entries?: unknown }).entries)
      menu = props.popup as Menu;
    return props.trigger({});
  },
}));
afterAll(() => {
  mock.module("next-intl/server", () => intlServer);
  mock.module("next/navigation", () => navigation);
  mock.module("@/components/ui/lazy-popup", () => realPopup);
});

const { viewerOfRequest } = await import("@/lib/sermo/client");
const { ThreadTools } = await import("./thread-tools");
const { ThreadToolbar } = await import("./thread-toolbar");

beforeEach(() => {
  menu = undefined;
  mock.module("@/lib/sermo/session", () => ({ getViewer: viewerOfRequest }));
  globalThis.fetch = (async (url: string) => {
    const { pathname } = new URL(url);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(true));
    if (pathname.includes("bookmarks"))
      return Response.json({ bookmarked: [7] });
    return Response.json({ items: [], nextCursor: null });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

async function html(node: React.ReactNode) {
  const stream = await renderToReadableStream(withIntl(node));
  await stream.allReady;
  return new Response(stream).text();
}

const may = {
  stick: false,
  feature: false,
  lock: false,
  move: false,
  merge: false,
  split: false,
  delete: false,
  hardDelete: false,
  hardDeleteAny: false,
  attach: false,
  restoreDeleted: false,
  restoreWaiting: false,
  any: false,
};

function context(tools: Record<string, unknown> | null) {
  return {
    thread: {
      id: 7,
      nodeId: 2,
      firstPostId: 1,
      state: "visible",
      isSticky: false,
      isLocked: false,
      cover: null,
    },
    may,
    viewerId: tools ? 1 : null,
    contentOpen: true,
    canReactHere: true,
    canQuote: true,
    selecting: false,
    highlighted: false,
    poll: null,
    tools: tools && {
      watching: null,
      canWatch: true,
      canEditTitle: false,
      tags: null,
      addPoll: null,
      staffPick: false,
      mayRemoveCover: false,
      ...tools,
    },
  } as never;
}

test("a guest's row is the pager alone", async () => {
  const out = await html(
    <ThreadTools context={context(null)} start={<nav>pager</nav>} />,
  );
  expect(out).toBe("<nav>pager</nav>");
});

// XenForo's row: the pager on the left; Follow, the bookmark and "•••" on the right, all boxed
// buttons. What the member may change is in the menu, not on rows of its own.
test("a member's row holds the pager, Follow, the bookmark and the menu, in that order", async () => {
  const out = await html(
    <ThreadTools
      context={context({ canEditTitle: true, tags: ["a"] })}
      start={<nav>pager</nav>}
    />,
  );
  const at = (words: string) => out.indexOf(words);
  expect(at("pager")).toBeGreaterThan(-1);
  expect(at("Follow thread")).toBeGreaterThan(at("pager"));
  expect(at("Remove bookmark")).toBeGreaterThan(at("Follow thread"));
  expect(at('aria-label="More options"')).toBeGreaterThan(
    at("Remove bookmark"),
  );
  // The bookmark is boxed like the buttons beside it.
  const bookmark = out.slice(out.lastIndexOf("<button", at("Remove bookmark")));
  expect(bookmark.slice(0, bookmark.indexOf(">"))).toContain("border-border");
  expect(out).not.toContain("Edit thread");
  expect(out).not.toContain("Edit tags");
  expect(out).not.toContain("Email me");
});

test("a member who watches the thread reads Following", async () => {
  const out = await html(
    <ThreadTools
      context={context({ watching: { email: true } })}
      start={null}
    />,
  );
  expect(out).toContain("Following");
  expect(out).not.toContain("Follow thread");
});

test("the menu offers edit, the tags, the poll and moderation in XenForo's order, as each applies", async () => {
  await html(
    <ThreadToolbar
      threadId={7}
      start={null}
      watch={null}
      bookmark={null}
      edit
      tags={[]}
      poll={{ attachIn: null }}
      moderation={<p>panel</p>}
      selecting={false}
    />,
  );
  expect(offered()).toEqual([
    { id: "edit", label: "Edit thread" },
    { id: "tags", label: "Add tags" },
    { id: "poll", label: "Add a poll or quiz" },
    { id: "moderate", label: "Moderate" },
  ]);
  menu = undefined;
  const none = await html(
    <ThreadToolbar
      threadId={7}
      start={null}
      watch={null}
      bookmark={null}
      edit={false}
      tags={["a"]}
      poll={null}
      moderation={false}
      selecting={false}
    />,
  );
  expect(offered()).toEqual([{ id: "tags", label: "Edit tags" }]);
  expect(none).not.toContain("panel");
});

test("the moderation panel is open from the start while posts are picked for a split", async () => {
  const toolbar = (selecting: boolean) => (
    <ThreadToolbar
      threadId={7}
      start={null}
      watch={null}
      bookmark={null}
      edit={false}
      tags={null}
      poll={null}
      moderation={<p>moderation panel</p>}
      selecting={selecting}
    />
  );
  expect(await html(toolbar(true))).toContain("moderation panel");
  expect(await html(toolbar(false))).not.toContain("moderation panel");
});
