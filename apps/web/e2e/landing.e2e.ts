import type { Browser, Locator, Page } from "@playwright/test";
import {
  box,
  expect,
  MEMBER_STATE,
  PICTURE_HOST,
  phoneWidth,
  ready,
  rejectCookies,
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
    // Over the middle of the page, away from the header and its panels.
    const { width, height } = page.viewportSize() ?? { width: 0, height: 0 };
    await page.mouse.move(width / 2, height / 2);
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
  // The browser's own jump to the address can put it there before the page's code has started
  // the landing (the dimming shows it has); a reader's action before that is not one the hold
  // can see.
  await expect(
    page.locator("div.pointer-events-none.fixed.z-50"),
    "the landing has begun",
  ).toBeAttached();
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

// Opens the alerts and returns where their rows are: the header's panel where the header has the
// bell, the notifications page where a phone's bottom bar links to it instead.
async function openAlerts(page: Page) {
  if (phoneWidth(page)) {
    await page
      .getByRole("navigation")
      .getByRole("link", { name: /^Alerts/ })
      .click();
    await expect(page).toHaveURL(/\/notifications/);
    await ready(page);
    return "main";
  }
  await page.getByRole("button", { name: /^Alerts/ }).click();
  return '[role="dialog"]';
}

const visibleLink = (scope: Page | Locator, selector: string) =>
  scope.locator(selector).filter({ visible: true }).first();

test.beforeEach(async ({ page }) => {
  await slowPictures(page);
});

test("an alert in the header's panel or the phone's alerts lands on its post, wall post, comment and message @landing", async ({
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
    const rows = await openAlerts(page);
    await visibleLink(page, `${rows} a[href="${target.href}"]`).click();
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
    // A tall screen loads the list's next page at once; a click while it comes in can be lost
    // (the list's address update preempts the navigation), so the list settles first.
    await page.waitForLoadState("networkidle");
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

// Opens the feed's pages, newest first, until one holds the link: the seed's thread can be below
// a page of newer items.
async function feedPageWith(page: Page, link: Locator) {
  await page.goto("/");
  for (let pages = 0; pages < 10; pages += 1) {
    await ready(page);
    if ((await link.count()) > 0) return;
    const next = page.locator('main a[href*="cursor="]');
    if ((await next.count()) === 0) break;
    const href = await next.last().getAttribute("href");
    if (!href) break;
    await page.goto(href);
  }
  await expect(link.first(), "the feed holds the link").toBeAttached();
}

test("the feed's link to a thread's newest reply carries its page and lands on it @landing", async ({
  page,
}) => {
  const { threadId } = seed();
  // A new reply brings the thread to the top of the feed, with a link to that reply.
  await page.goto("/forums");
  const made = await page.request.post(`/api/v1/threads/${threadId}/posts`, {
    data: { body: "A reply for the feed." },
    headers: { origin: new URL(page.url()).origin },
  });
  expect(made.ok(), "the reply is posted").toBe(true);
  const { id } = (await made.json()) as { id: number };
  // The card's reply link and the compact row's both name the page that holds the reply.
  const replies = page.locator(`main a[href*="#post-${id}"]`);
  await feedPageWith(page, replies);
  for (const href of await replies.evaluateAll((links) =>
    links.map((link) => link.getAttribute("href") ?? ""),
  ))
    expect(href).toMatch(/[?&]page=\d+#post-\d+$/);
  await replies.filter({ visible: true }).first().click();
  await expectLandedAtHash(page);
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
    await ready(page);
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
      // A guest answers the cookie banner first: it covers the page until then.
      if (!member) {
        await page.goto("/cookies");
        await rejectCookies(page);
      }
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
  // Away, in the app, by the sticky header's home link, pressed where it is: Playwright's own
  // click scrolls the page to the element first, which would move the place before it is left.
  const home = await box(
    page
      .locator('[data-site-header] a[href="/"]')
      .filter({ visible: true })
      .first(),
  );
  await page.mouse.click(home.x + home.width / 2, home.y + home.height / 2);
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await page.goBack();
  await expect
    .poll(() => page.evaluate(() => window.scrollY), { timeout: 10_000 })
    .toBeGreaterThan(left - 40);
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(left + 40);
  await page.goForward();
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await page.goBack();
  await expect
    .poll(() => page.evaluate(() => window.scrollY), { timeout: 10_000 })
    .toBeGreaterThan(left - 40);

  // WebKit puts a reloaded page back where it likes (it jumped 1100 px further in a check), and a
  // reload is left to the browser: the place is checked where the browser keeps it.
  if (page.context().browser()?.browserType().name() === "webkit") return;
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
  const rows = await openAlerts(page);
  await visibleLink(page, `${rows} a[href="/profile-posts/${id}"]`).click();
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

// Writes `text` in the editor `name` names inside `scope` and sends it with `send`.
async function write(
  scope: Locator,
  name: string | RegExp,
  text: string,
  send: string,
) {
  const editor = scope.getByRole("textbox", { name });
  await editor.click();
  await editor.pressSequentially(text);
  await scope.getByRole("button", { name: send, exact: true }).click();
}

// What the member writes on a wall lands on it: the page goes to the item, not to the top.
test("a comment written on the wall, on a later page of it too, lands on the comment @landing", async ({
  page,
}) => {
  const { landing } = seed();
  // The newest post, on the wall's first page, and the oldest, on its last page.
  for (const [address, postId] of [
    [`/members/${landing.memberId}`, landing.wall.newestPostId],
    [`/profile-posts/${landing.wall.oldestPostId}`, landing.wall.oldestPostId],
  ] as const) {
    await page.goto(address);
    await ready(page);
    const text = `Wall comment ${Date.now().toString(36)}`;
    await write(
      page.locator(`[id="profile-post-${postId}-comment"]`),
      "Write a comment…",
      text,
      "Post comment",
    );
    await expect(page).toHaveURL(/#profile-comment-\d+$/, { timeout: 30_000 });
    const id = await expectLandedAtHash(page);
    await expect(drawn(page, id)).toContainText(text);
  }
});

test("a comment written in the feed lands on it there @landing", async ({
  page,
}) => {
  const { landing } = seed();
  const card = page.locator(
    `[id="feed-profile-post-${landing.wall.newestPostId}"]`,
  );
  await feedPageWith(page, card);
  const feed = page.url();
  const text = `Feed comment ${Date.now().toString(36)}`;
  await write(card, "Write a comment…", text, "Post comment");
  const comment = card
    .locator('[id^="profile-comment-"]')
    .filter({ hasText: text });
  await expectLandedAt(page, comment);
  // Still the feed: the page is not left, nor its address changed.
  expect(page.url()).toBe(feed);
});

test("a new wall post lands on it @landing", async ({ page }) => {
  const { landing } = seed();
  await page.goto(`/members/${landing.memberId}`);
  await ready(page);
  await page.getByRole("button", { name: /^Write something on/ }).click();
  const text = `New wall post ${Date.now().toString(36)}`;
  await write(page.getByRole("dialog"), /^Write something on/, text, "Post");
  await expect(page).toHaveURL(/#profile-post-\d+$/, { timeout: 30_000 });
  const id = await expectLandedAtHash(page);
  await expect(drawn(page, id)).toContainText(text);
});

test("an edited comment and an edited wall post land on themselves @landing", async ({
  page,
}) => {
  const { landing } = seed();
  await page.goto(`/members/${landing.memberId}`);
  await ready(page);
  const post = drawn(page, `profile-post-${landing.wall.newestPostId}`);
  const comment = post.locator('[id^="profile-comment-"]').first();
  const commentId = (await comment.getAttribute("id")) ?? "";
  for (const [item, id] of [
    [comment, commentId],
    [post, `profile-post-${landing.wall.newestPostId}`],
  ] as const) {
    const text = ` edited ${Date.now().toString(36)}`;
    await item
      .getByRole("button", { name: "Edit", exact: true })
      .first()
      .click();
    const editor = item.getByRole("textbox", { name: "Edit your text…" });
    await editor.click();
    await editor.press("Control+End");
    await editor.pressSequentially(text);
    await item.getByRole("button", { name: "Save changes" }).click();
    await expectLandedAt(page, drawn(page, id));
    await expect(drawn(page, id)).toContainText(text.trim());
  }
});

// "Show more comments" loads the older ones above, in place: no navigation, no landing or dimming,
// and the comment that was first stays where it was on the screen. Batch after batch, until the
// button goes.
async function expectEarlierInPlace(page: Page, list: Locator) {
  const rows = list.locator('[id^="profile-comment-"]');
  const button = list.getByRole("button", { name: "Show more comments" });
  const address = page.url();
  for (let batch = 0; batch < 5 && (await button.count()) > 0; batch += 1) {
    // The reader goes to the button: an action of theirs (here a key, as no wheel turn is in every
    // browser) ends the hold on the previous batch's place, which a script's scroll does not.
    await page.keyboard.press("Shift");
    await button.scrollIntoViewIfNeeded();
    const before = await rows.count();
    const first = rows.first();
    const id = (await first.getAttribute("id")) ?? "";
    const top = (await box(drawn(page, id))).y;
    await button.click();
    await expect.poll(() => rows.count()).toBeGreaterThan(before);
    // The batch's pictures come late (see `slowPictures`): the place holds while they load.
    await expect
      .poll(() =>
        list.evaluate((element) =>
          [...element.querySelectorAll("img")].every((image) => image.complete),
        ),
      )
      .toBe(true);
    await page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done)),
        ),
    );
    expect(
      Math.abs((await box(drawn(page, id))).y - top),
      "the comment that was first stays where it was",
    ).toBeLessThanOrEqual(2);
    expect(page.url(), "nothing was navigated to").toBe(address);
    await expect(
      page.locator("div.pointer-events-none.fixed.z-50"),
      "nothing is dimmed",
    ).toHaveCount(0);
  }
  await expect(button, "the button goes once all are shown").toHaveCount(0);
}

test("show more comments loads the older ones in place on the wall @landing", async ({
  page,
}) => {
  const { landing } = seed();
  // The post with the long run of comments: on the wall's last page, reached by its address,
  // whose landing the reader then leaves by scrolling.
  await page.goto(`/profile-posts/${landing.wall.oldestPostId}`);
  await expectLandedAtHash(page);
  await takeOver(page);
  await expectEarlierInPlace(
    page,
    drawn(page, `profile-post-${landing.wall.oldestPostId}`),
  );
  const shown = await drawn(page, `profile-post-${landing.wall.oldestPostId}`)
    .locator('[id^="profile-comment-"]')
    .count();
  expect(shown, "every comment is shown").toBeGreaterThanOrEqual(
    landing.wall.comments,
  );
});

test("show more comments loads the older ones in place in the feed @landing", async ({
  page,
}) => {
  const { landing } = seed();
  const card = page.locator(
    `[id="feed-profile-post-${landing.wall.newestPostId}"]`,
  );
  await feedPageWith(page, card);
  await expectEarlierInPlace(page, card);
});

// The ids of the comments drawn in a list, in order; each drawn once.
async function commentIds(list: Locator) {
  const ids = await list
    .locator('[id^="profile-comment-"]')
    .evaluateAll((rows) => rows.map((row) => row.id));
  expect(new Set(ids).size, "no comment is drawn twice").toBe(ids.length);
  return ids;
}

// The comments loaded in place follow the page when it is drawn again: an edit shows, a deleted
// comment goes (one of the newest few too, without a copy), a new one leaves no gap.
test("the comments loaded in place follow an edit, a deletion and a new comment @landing", async ({
  page,
}) => {
  const { landing } = seed();
  const postId = landing.wall.newestPostId;
  // A comment of the member's own to delete later, so the seed keeps its count.
  await page.goto(`/members/${landing.memberId}`);
  await ready(page);
  await write(
    page.locator(`[id="profile-post-${postId}-comment"]`),
    "Write a comment…",
    `Doomed comment ${Date.now().toString(36)}`,
    "Post comment",
  );
  await expect(page).toHaveURL(/#profile-comment-\d+$/, { timeout: 30_000 });
  const doomed = new URL(page.url()).hash.slice(1);

  await page.goto(`/members/${landing.memberId}`);
  await ready(page);
  const post = drawn(page, `profile-post-${postId}`);
  await expectEarlierInPlace(page, post);
  const all = await commentIds(post);
  expect(all.at(-1), "the new comment is among the newest").toBe(doomed);

  // An edit of a loaded comment shows in it, once.
  const oldest = all[0] ?? "";
  const text = ` edited ${Date.now().toString(36)}`;
  const item = drawn(page, oldest);
  await item.getByRole("button", { name: "Edit", exact: true }).first().click();
  const editor = item.getByRole("textbox", { name: "Edit your text…" });
  await editor.click();
  await editor.press("Control+End");
  await editor.pressSequentially(text);
  await item.getByRole("button", { name: "Save changes" }).click();
  await expect(drawn(page, oldest)).toContainText(text.trim(), {
    timeout: 30_000,
  });
  expect(await commentIds(post)).toEqual(all);

  // One of the newest few, drawn by the server, deleted: the loaded ones close up, with no copy.
  const gone = drawn(page, doomed);
  await gone.getByRole("button", { name: "Delete", exact: true }).click();
  await gone.locator('button[type="submit"]', { hasText: "Delete" }).click();
  await expect
    .poll(() => commentIds(post), { timeout: 30_000 })
    .toEqual(all.filter((id) => id !== doomed));
});

test("the comments loaded in place in the feed leave no gap after a new comment @landing", async ({
  page,
}) => {
  const { landing } = seed();
  const card = page.locator(
    `[id="feed-profile-post-${landing.wall.newestPostId}"]`,
  );
  await feedPageWith(page, card);
  await expectEarlierInPlace(page, card);
  const before = await commentIds(card);
  const text = `Feed comment ${Date.now().toString(36)}`;
  await write(card, "Write a comment…", text, "Post comment");
  const comment = card
    .locator('[id^="profile-comment-"]')
    .filter({ hasText: text });
  await expect(comment).toBeVisible({ timeout: 30_000 });
  const added = (await comment.getAttribute("id")) ?? "";
  await expect
    .poll(() => commentIds(card), { timeout: 30_000 })
    .toEqual([...before, added]);
});

test("the page drawn again keeps the comments loaded, no older ones, and the button while more are left @landing", async ({
  page,
}) => {
  const { landing } = seed();
  await page.goto(`/profile-posts/${landing.wall.oldestPostId}`);
  await expectLandedAtHash(page);
  await takeOver(page);
  const post = drawn(page, `profile-post-${landing.wall.oldestPostId}`);
  const button = post.getByRole("button", { name: "Show more comments" });
  const before = (await commentIds(post)).length;
  await button.click();
  await expect
    .poll(async () => (await commentIds(post)).length)
    .toBeGreaterThan(before);
  const loaded = await commentIds(post);
  // An edit of the newest comment draws the page again.
  const newest = drawn(page, loaded.at(-1) ?? "");
  await newest
    .getByRole("button", { name: "Edit", exact: true })
    .first()
    .click();
  const editor = newest.getByRole("textbox", { name: "Edit your text…" });
  await editor.click();
  await editor.press("Control+End");
  const text = ` again ${Date.now().toString(36)}`;
  await editor.pressSequentially(text);
  await newest.getByRole("button", { name: "Save changes" }).click();
  await expect(newest).toContainText(text.trim(), { timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  expect(await commentIds(post)).toEqual(loaded);
  await expect(button).toBeVisible();
});
