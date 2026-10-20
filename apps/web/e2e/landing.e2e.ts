import type { Browser, Locator, Page } from "@playwright/test";
import {
  expect,
  MEMBER_STATE,
  PICTURE_HOST,
  phoneWidth,
  ready,
  seed,
  servePicture,
  test,
} from "./fixtures";

// A link to an item, from wherever it is followed, opens the page that holds it with the item's top
// just under the sticky header, at once, and keeps it there while the pictures above it load,
// until the reader scrolls, touches or types (DECISIONS "An item's link lands at its start").

test.use({ storageState: MEMBER_STATE });
// A service worker would answer the pictures past the routes that slow them.
test.use({ serviceWorkers: "block" });

const PICTURE_DELAY_MS = 1_500;
const POSTS_PER_PAGE = 20;
const TARGET = /#((?:post|profile-post|profile-comment|message)-\d+)$/;

// The drawn copy of the element with this id: a page left earlier can stay in the document,
// hidden, with the same ids.
const drawn = (page: Page, id: string) =>
  page.locator(`[id="${id}"]`).filter({ visible: true });

// Every picture arrives late, as on a slow line; the seeded ones are then served by the fixture.
async function slowPictures(page: Page) {
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() === "image")
      await new Promise((done) => setTimeout(done, PICTURE_DELAY_MS));
    await route.fallback();
  });
}

// Where the element's top is against where a landing puts it: the header's bottom plus the
// element's scroll margin (the landing gap). A page too short to bring it that high stops at its
// end, with the element lower.
function placement(locator: Locator) {
  return locator.evaluate((element) => {
    const header = document.querySelector("[data-site-header]");
    const under = header
      ? Math.max(0, header.getBoundingClientRect().bottom)
      : 0;
    const gap =
      Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 0;
    const end = document.documentElement.scrollHeight - window.innerHeight;
    return {
      off: element.getBoundingClientRect().top - (under + gap),
      atEnd: window.scrollY >= end - 1,
    };
  });
}

const isLanded = (at: { off: number; atEnd: boolean }) =>
  Math.abs(at.off) <= 2 || (at.off > 0 && at.atEnd);

// The reader takes the page: a wheel turn up where there is a mouse wheel; mobile WebKit has none,
// so a key press (which ends the hold too) and a scroll stand for it.
async function takeOver(page: Page) {
  if (page.context().browser()?.browserType().name() === "webkit") {
    await page.keyboard.press("Shift");
    await page.evaluate(() => window.scrollBy(0, -300));
  } else {
    await page.mouse.wheel(0, -300);
  }
}

// The item is drawn with its top under the header at once, stays there once every picture has
// loaded, and the reader's first action lets it go.
async function expectLandedAt(page: Page, item: Locator) {
  await expect(item).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => isLanded(await placement(item)), {
      message: "the item's top lands under the header",
      timeout: 3_000,
    })
    .toBe(true);
  await page.waitForFunction(
    () => [...document.images].every((image) => image.complete),
    undefined,
    { timeout: 30_000 },
  );
  await page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done)),
      ),
  );
  const settled = await placement(item);
  expect(
    isLanded(settled),
    `the item stays under the header once the pictures are in (${JSON.stringify(settled)})`,
  ).toBe(true);
  await takeOver(page);
  await page.waitForTimeout(800);
  const released = await placement(item);
  expect(
    released.off,
    "the hold lets go once the reader scrolls",
  ).toBeGreaterThan(100);
}

// The page the address now names lands on the item its hash names; returns the item's id.
async function expectLandedAtHash(page: Page) {
  await expect(page).toHaveURL(TARGET, { timeout: 30_000 });
  const id = TARGET.exec(new URL(page.url()).hash)?.[1] ?? "";
  await expectLandedAt(page, drawn(page, id));
  return id;
}

// The thread address of a post, as the share button gives it.
const postAddress = (threadId: number, position: number, postId: number) => {
  const page = Math.floor(position / POSTS_PER_PAGE) + 1;
  return `/threads/${threadId}${page > 1 ? `?page=${page}` : ""}#post-${postId}`;
};

// The four kinds of item, each by its own address and by the element that draws it.
function targets() {
  const { landing } = seed();
  return [
    {
      kind: "post",
      key: `post:${landing.post.id}`,
      href: `/posts/${landing.post.id}`,
      id: `post-${landing.post.id}`,
    },
    {
      kind: "wall post",
      key: `profile_post:${landing.wall.oldestPostId}`,
      href: `/profile-posts/${landing.wall.oldestPostId}`,
      id: `profile-post-${landing.wall.oldestPostId}`,
    },
    {
      kind: "comment",
      key: `profile_post_comment:${landing.wall.commentId}`,
      href: `/profile-comments/${landing.wall.commentId}`,
      id: `profile-comment-${landing.wall.commentId}`,
    },
    {
      kind: "message",
      key: `conversation_message:${landing.conversation.messageId}`,
      href: `/conversations/messages/${landing.conversation.messageId}`,
      id: `message-${landing.conversation.messageId}`,
    },
  ];
}

// The lists are long enough for each target to be off the first page.
function expectLongLists() {
  const { landing } = seed();
  expect(landing.wall.posts, "wall posts seeded").toBeGreaterThan(20);
  expect(landing.wall.comments, "comments seeded").toBeGreaterThan(20);
  expect(landing.conversation.messages, "messages seeded").toBeGreaterThan(40);
}

// Opens the alerts: the header's bell where it has one, the account menu's tab on a phone.
async function openAlerts(page: Page) {
  if (phoneWidth(page)) {
    await page.getByRole("button", { name: "Account menu" }).click();
    await page
      .getByRole("dialog", { name: "Account menu" })
      .getByRole("tablist", { name: "Account menu sections" })
      .getByRole("tab", { name: "Alerts" })
      .click();
  } else {
    await page.getByRole("button", { name: /^Alerts/ }).click();
  }
}

const visibleLink = (scope: Page | Locator, selector: string) =>
  scope.locator(selector).filter({ visible: true }).first();

test.beforeEach(async ({ page }) => {
  await slowPictures(page);
});

test("an alert in the header's panel lands on its post, wall post, comment and message @landing", async ({
  page,
}) => {
  expectLongLists();
  const { landing } = seed();
  for (const target of targets()) {
    expect(landing.alerted, `an alert for the ${target.kind}`).toContain(
      target.key,
    );
    await page.goto("/forums");
    await ready(page);
    await openAlerts(page);
    await visibleLink(page, `[role="dialog"] a[href="${target.href}"]`).click();
    await expectLandedAt(page, drawn(page, target.id));
  }
});

test("a row of the notifications page lands on its post, wall post, comment and message @landing", async ({
  page,
}) => {
  const { landing } = seed();
  for (const target of targets()) {
    expect(landing.alerted, `an alert for the ${target.kind}`).toContain(
      target.key,
    );
    await page.goto("/notifications");
    await ready(page);
    await visibleLink(page, `main a[href="${target.href}"]`).click();
    await expectLandedAt(page, drawn(page, target.id));
  }
});

test("each item's own address lands on it when typed @landing", async ({
  page,
}) => {
  expectLongLists();
  for (const target of targets()) {
    await page.goto(target.href);
    expect(await expectLandedAtHash(page)).toBe(target.id);
  }
});

test("old XenForo addresses land on the item they name @landing", async ({
  page,
}) => {
  const { threadId, landing } = seed();
  const post = landing.post.id;
  const addresses: [string, string][] = [
    [`/tema/x.${threadId}/post-${post}`, `post-${post}`],
    [`/respuestas/${post}/`, `post-${post}`],
    [`/goto/post?id=${post}`, `post-${post}`],
    [`/index.php?threads/x.${threadId}/post-${post}`, `post-${post}`],
    // XenForo drew 40 posts a page: its second page starts on this site's third.
    [`/tema/x.${threadId}/page-2#post-${post}`, `post-${post}`],
    [
      `/profile-posts/${landing.wall.oldestPostId}/`,
      `profile-post-${landing.wall.oldestPostId}`,
    ],
    [
      `/profile-posts/comments/${landing.wall.commentId}/`,
      `profile-comment-${landing.wall.commentId}`,
    ],
    [
      `/conversaciones/replies/${landing.conversation.messageId}/`,
      `message-${landing.conversation.messageId}`,
    ],
  ];
  for (const [address, id] of addresses) {
    await page.goto(address);
    expect(await expectLandedAtHash(page), address).toBe(id);
  }
});

test("the feed's link to a thread's newest reply carries its page and lands on it @landing", async ({
  page,
}) => {
  const { threadId } = seed();
  await page.goto("/");
  await ready(page);
  // The card's reply link and the compact row's both name the page that holds the reply.
  const replies = page.locator(
    `main a[href*="/threads/${threadId}"][href*="#post-"]`,
  );
  await expect(replies.first()).toBeAttached();
  for (const href of await replies.evaluateAll((links) =>
    links.map((link) => link.getAttribute("href") ?? ""),
  ))
    expect(href).toMatch(/[?&]page=\d+#post-\d+$/);
  await replies.filter({ visible: true }).first().click();
  await expectLandedAtHash(page);
});

test("the feed's wall post links land on the wall post @landing", async ({
  page,
}) => {
  const { landing } = seed();
  const id = landing.wall.newestPostId;
  await page.goto("/");
  await ready(page);
  await visibleLink(page, `main a[href$="#profile-post-${id}"]`).click();
  await expectLandedAt(page, drawn(page, `profile-post-${id}`));
});

test("a thread's first unread and latest addresses land on a post @landing", async ({
  page,
}) => {
  const { threadId, landing } = seed();
  await page.goto(`/threads/${threadId}/latest`);
  expect(await expectLandedAtHash(page)).toMatch(/^post-\d+$/);
  await page.goto(`/threads/${threadId}/unread`);
  await expectLandedAtHash(page);
  await page.goto(`/conversations/${landing.conversation.id}/unread`);
  await expectLandedAtHash(page);
});

test("a search result lands on the post on its page @landing", async ({
  page,
}) => {
  const { landing } = seed();
  // The search index is written by a background job: look again until the post is found.
  const result = page.locator(`main a[href*="#post-${landing.post.id}"]`);
  await expect(async () => {
    await page.goto(`/search?q=${landing.word}`);
    await expect(result.first()).toBeAttached({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  await result.filter({ visible: true }).first().click();
  await expectLandedAt(page, drawn(page, `post-${landing.post.id}`));
});

test("a quote's link to its post, from another thread, lands on the post @landing", async ({
  page,
}) => {
  const { peerThreadId, landing } = seed();
  await page.goto(`/threads/${peerThreadId}`);
  await ready(page);
  await visibleLink(page, `main a[href="/posts/${landing.post.id}"]`).click();
  await expectLandedAt(page, drawn(page, `post-${landing.post.id}`));
});

// A fresh browser, as someone who was sent the link opens it.
async function freshPage(browser: Browser, member: boolean) {
  const context = await browser.newContext({
    storageState: member ? MEMBER_STATE : { cookies: [], origins: [] },
    serviceWorkers: "block",
  });
  await context.route(`${PICTURE_HOST}/**`, servePicture);
  const page = await context.newPage();
  await slowPictures(page);
  return page;
}

test("a shared link lands for a guest and for a member @landing", async ({
  browser,
}) => {
  const { threadId, landing } = seed();
  const wall = `/members/${landing.memberId}`;
  const shared = [
    postAddress(threadId, landing.post.position, landing.post.id),
    `${wall}?post=${landing.wall.oldestPostId}#profile-post-${landing.wall.oldestPostId}`,
    `${wall}?post=${landing.wall.oldestPostId}&comment=${landing.wall.commentId}#profile-comment-${landing.wall.commentId}`,
  ];
  const message = `/conversations/${landing.conversation.id}?message=${landing.conversation.messageId}#message-${landing.conversation.messageId}`;
  for (const member of [false, true]) {
    const page = await freshPage(browser, member);
    try {
      for (const address of member ? [...shared, message] : shared) {
        await page.goto(address);
        await expectLandedAtHash(page);
      }
    } finally {
      await page.context().close();
    }
  }
});

test("a bookmark and the profile's posts land on the post @landing", async ({
  page,
}) => {
  const { landing } = seed();
  await page.goto("/forums");
  const origin = new URL(page.url()).origin;
  const marked = await page.request.put("/api/v1/bookmarks", {
    data: { contentType: "post", contentId: landing.post.id, bookmarked: true },
    headers: { origin },
  });
  expect(marked.ok(), "the post is bookmarked").toBe(true);
  const toPost = `main a[href="/posts/${landing.post.id}"], main a[href*="#post-${landing.post.id}"]`;
  for (const list of [
    "/account/bookmarks",
    `/members/${landing.memberId}?tab=posts`,
  ]) {
    await page.goto(list);
    await ready(page);
    await visibleLink(page, toPost).click();
    await expectLandedAt(page, drawn(page, `post-${landing.post.id}`));
  }
});

test("a conversation row opens at its newest message when all is read @landing", async ({
  page,
}) => {
  const { landing } = seed();
  await page.goto("/conversations");
  await ready(page);
  await visibleLink(
    page,
    `main a[href^="/conversations/${landing.conversation.id}?"], main a[href^="/conversations/${landing.conversation.id}/unread"]`,
  ).click();
  expect(await expectLandedAtHash(page)).toMatch(/^message-\d+$/);
});

test("a post's number on its own page lands on it @landing", async ({
  page,
}) => {
  const { threadId, landing } = seed();
  const id = `post-${landing.post.id}`;
  await page.goto(
    postAddress(threadId, landing.post.position, landing.post.id),
  );
  await expectLandedAt(page, drawn(page, id));
  await drawn(page, id).locator(`a[href$="#${id}"]`).first().click();
  await expectLandedAt(page, drawn(page, id));
});

test("Back and Forward put the reader where they were, and a reload keeps the place @landing", async ({
  page,
}) => {
  const { landing } = seed();
  await page.goto(`/posts/${landing.post.id}`);
  await expectLandedAtHash(page);
  const left = await page.evaluate(() => window.scrollY);
  // Away, in the app: the thread's forum from its breadcrumb.
  await visibleLink(page, 'a[href^="/forums/"]').click();
  await expect(page).toHaveURL(/\/forums\/\d+/);
  await page.goBack();
  await expect
    .poll(() => page.evaluate(() => window.scrollY), { timeout: 10_000 })
    .toBeGreaterThan(left - 40);
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(left + 40);
  await page.goForward();
  await expect(page).toHaveURL(/\/forums\/\d+/);
  await page.goBack();
  await expect
    .poll(() => page.evaluate(() => window.scrollY), { timeout: 10_000 })
    .toBeGreaterThan(left - 40);

  await page.reload();
  await ready(page);
  await expect
    .poll(() => page.evaluate(() => window.scrollY), { timeout: 10_000 })
    .toBeGreaterThan(left - 40);
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(left + 40);
});

test("a wall post on a wall left earlier lands on the drawn copy, not a hidden one @landing", async ({
  page,
}) => {
  const { landing } = seed();
  const id = landing.wall.newestPostId;
  expect(landing.alerted, "an alert for the newest wall post").toContain(
    `profile_post:${id}`,
  );
  // The wall's first page holds the post: once left, the page can stay in the document, hidden.
  await page.goto(`/members/${landing.memberId}`);
  await ready(page);
  await expect(drawn(page, `profile-post-${id}`)).toBeVisible();
  await visibleLink(page, 'a[href="/"]').click();
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await ready(page);
  await openAlerts(page);
  await visibleLink(
    page,
    `[role="dialog"] a[href="/profile-posts/${id}"]`,
  ).click();
  await expectLandedAt(page, drawn(page, `profile-post-${id}`));
});

test("after a reply the member's new post is in view @landing", async ({
  page,
}) => {
  const { threadId, landing } = seed();
  await page.goto(
    postAddress(threadId, landing.post.position, landing.post.id),
  );
  await ready(page);
  const text = `Landing reply ${Date.now().toString(36)}`;
  const editor = page.getByRole("textbox", { name: "Type your message here." });
  await editor.click();
  await editor.pressSequentially(text);
  await page.getByRole("button", { name: "Post reply" }).click();
  await expect(
    page.getByRole("article").filter({ hasText: text }),
  ).toBeInViewport({ timeout: 30_000 });
});
