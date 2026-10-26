import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { groupBody, permissionDefinitionBody } from "@/lib/test-bodies";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";
import { fakeBackend } from "../../groups/test-backend";

mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const intl = await import("next-intl/server");
const nextIntl = await import("next-intl");
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useLocale: () => "en",
  useTranslations: useIntl.useTranslations,
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));

const { ForumPermissions } = await import("./forum-permissions");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next-intl", () => nextIntl);
});

const FORUM = {
  id: 2,
  parentId: null,
  type: "forum",
  title: "General",
  description: "",
  icon: null,
  iconKey: null,
  cover: null,
  position: 1,
  tabId: null,
  depth: 0,
  threadCount: 0,
  postCount: 0,
  lastPost: null,
  permissions: { canPost: false, canModerate: false },
  settings: {
    requireThreadApproval: false,
    requireReplyApproval: false,
    isReadOnly: false,
    countsPosts: true,
    minAccountAgeDays: 0,
    minPostCount: 0,
    requirePrefix: false,
    isAdult: false,
  },
  adultByParent: false,
};

const set = (groupId: number | null, userId: number | null) => ({
  groupId,
  userId,
  nodeId: 2,
  entries: [],
});

async function page(params: Record<string, string>) {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(true)),
    "nodes.list": () => Response.json({ items: [FORUM], nextCursor: null }),
    "groups.list": () => Response.json({ items: [groupBody({ id: 1 })] }),
    "permissions.definitions": () =>
      Response.json({
        items: [
          permissionDefinitionBody("forum.guestPost", "flag", "node"),
          permissionDefinitionBody("forum.view", "flag", "node"),
        ],
      }),
    "permissions.listNode": () => Response.json({ items: [set(1, null)] }),
    "permissions.list": () => Response.json(set(1, null)),
    "users.cards": () => Response.json({ items: [] }),
  });
  const tree = await ForumPermissions({
    searchParams: Promise.resolve(params),
  });
  return new Response(await renderToReadableStream(withIntl(tree))).text();
}

const carried =
  '<input type="hidden" name="permission" value="forum.guestPost"/>';

test("the permission a search result led to is carried by the forum picker", async () => {
  const html = await page({ permission: "forum.guestPost" });
  expect(html).toContain(carried);
});

test("on a forum, every way to a matrix carries the permission, and the matrix starts on it", async () => {
  const listed = await page({ node: "2", permission: "forum.guestPost" });
  // The picker, the form that adds a group, the member search, and the link that edits the
  // group's entries.
  expect(listed.split(carried)).toHaveLength(4);
  expect(listed).toContain(
    'href="?node=2&amp;permission=forum.guestPost&amp;group=1"',
  );
  const editing = await page({
    node: "2",
    group: "1",
    permission: "forum.guestPost",
  });
  expect(editing).toMatch(/id="matrix-filter"[^>]*value="forum.guestPost"/);
});

test("without a search result the forum screen is as it was", async () => {
  const html = await page({ node: "2" });
  expect(html).not.toContain('name="permission"');
  expect(html).toContain('href="?node=2&amp;group=1"');
});
