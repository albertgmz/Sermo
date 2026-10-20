import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { profilePostBody } from "@/lib/test-bodies";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) => key,
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));

const { default: ProfilePostPage } = await import("./page");
const { default: ProfileCommentPage } = await import(
  "../../profile-comments/[id]/page"
);

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

// The backend: wall post 12 is on member 5's wall and holds comment 80; anything else is not found.
function backend() {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const { pathname } = new URL(url);
    asked.push(pathname);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(false));
    if (pathname === "/api/v1/profile-posts/12")
      return Response.json(profilePostBody({ id: 12, profileUserId: 5 }));
    if (pathname === "/api/v1/profile-comments/80/location")
      return Response.json({
        commentId: 80,
        profilePostId: 12,
        profileUserId: 5,
        wallCursor: null,
        commentsCursor: null,
      });
    return Response.json(
      { error: { code: "not_found", message: "Not found." } },
      { status: 404 },
    );
  }) as unknown as typeof fetch;
  return asked;
}

async function digestOf(page: Promise<unknown>) {
  try {
    await page;
  } catch (error) {
    return (error as { digest?: string }).digest;
  }
  throw new Error("the page answered with a page");
}

const props = (id: string) =>
  ({ params: Promise.resolve({ locale: "en", id }) }) as never;
const redirectTo = (path: string) => `NEXT_REDIRECT;replace;${path};307;`;
const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";

test("a wall post's address goes to the wall, at the post", async () => {
  backend();
  expect(await digestOf(ProfilePostPage(props("12")))).toBe(
    redirectTo("/members/5?post=12#profile-post-12"),
  );
});

test("a comment's address goes to the wall, at the comment of its post", async () => {
  backend();
  expect(await digestOf(ProfileCommentPage(props("80")))).toBe(
    redirectTo("/members/5?post=12&comment=80#profile-comment-80"),
  );
});

test("a missing post or comment, or an id that is not one, is a 404", async () => {
  const asked = backend();
  expect(await digestOf(ProfilePostPage(props("13")))).toBe(NOT_FOUND);
  expect(await digestOf(ProfileCommentPage(props("81")))).toBe(NOT_FOUND);
  asked.length = 0;
  expect(await digestOf(ProfilePostPage(props("x")))).toBe(NOT_FOUND);
  expect(await digestOf(ProfileCommentPage(props("07")))).toBe(NOT_FOUND);
  expect(asked).toEqual([]);
});
