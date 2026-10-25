import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type APIRequestContext, request } from "@playwright/test";
import {
  expect,
  type LandingSeed,
  MEMBER_STATE,
  PASSWORD,
  PEER,
  ready,
  rejectCookies,
  SEED_FILE,
  type Seed,
  test as setup,
  signInWith,
  TALL_PICTURE,
  USER,
  unique,
} from "./fixtures";

type Api = (
  path: string,
  init?: { method: string; data: unknown },
) => ReturnType<APIRequestContext["fetch"]>;

const picture = `[IMG]${TALL_PICTURE}[/IMG]`;

// Signs the member in once through the sign-in form and keeps the session (and the answer to the
// cookie banner) for the member's flows, makes one thread long enough to have three pages and what
// the landing flows aim at, and opens the main pages once so a development server has compiled
// them before the flows run.
setup("sign in, seed and warm up", async ({ page }) => {
  setup.setTimeout(900_000);
  await page.goto("/login");
  await rejectCookies(page);
  await ready(page);
  await signInWith(page);
  await expect(
    page.getByRole("button", { name: "Account menu" }),
  ).toBeVisible();

  const origin = new URL(page.url()).origin;
  const api: Api = (path, init) =>
    page.request.fetch(`/api/v1${path}`, {
      method: init?.method ?? "GET",
      data: init?.data,
      headers: { origin },
    });

  const nodes = (await (await api("/nodes")).json()) as {
    items: { id: number; type: string; permissions: { canPost: boolean } }[];
  };
  const forum = nodes.items.find(
    (node) => node.type === "forum" && node.permissions.canPost,
  );
  if (!forum) throw new Error(`${USER} may post in no forum of this site`);
  const made = await api(`/nodes/${forum.id}/threads`, {
    method: "POST",
    data: {
      title: unique("Phone check thread"),
      body: "A thread with three pages.",
    },
  });
  if (!made.ok())
    throw new Error(`the long thread was refused (${made.status()})`);
  const threadId = ((await made.json()) as { thread: { id: number } }).thread
    .id;
  // A page holds 20 posts: two pages need 21, and a forum's flood control may stop the loop early.
  // Two posts of the third page hold a tall picture; the last post, below them, is the one the
  // landing flows aim at, with a word only it has.
  const word = `landing${Date.now().toString(36)}`;
  let posts = 1;
  let last = { id: 0, position: 0 };
  for (let index = 0; index < 45; index += 1) {
    const text = `Reply number ${index + 1} of the phone check.`;
    const body =
      index === 44
        ? `${text} ${word}`
        : index === 40 || index === 41
          ? `${text}\n${picture}`
          : text;
    const reply = await api(`/threads/${threadId}/posts`, {
      method: "POST",
      data: { body },
    });
    if (!reply.ok()) break;
    last = (await reply.json()) as { id: number; position: number };
    posts += 1;
  }
  // Tests open `?page=3`, which needs 41 posts at 20 a page.
  if (posts < 41)
    throw new Error(`only ${posts} posts could be written to the long thread`);
  // Six pages of short posts: a skip, and with it "go to page", shows on the pager from there.
  const pager = await api(`/nodes/${forum.id}/threads`, {
    method: "POST",
    data: { title: unique("Pager check thread"), body: "Six pages." },
  });
  if (!pager.ok())
    throw new Error(`the pager thread was refused (${pager.status()})`);
  const pagerThreadId = ((await pager.json()) as { thread: { id: number } })
    .thread.id;
  for (let index = 0; index < 100; index += 1) {
    const reply = await api(`/threads/${pagerThreadId}/posts`, {
      method: "POST",
      data: { body: `Pager reply ${index + 1}.` },
    });
    if (!reply.ok())
      throw new Error(`the pager thread stopped at ${index + 1} posts`);
  }
  const peer = await peerSession(origin);
  let seed: Seed;
  try {
    const peerThreadId = await peerThread(peer, forum.id);
    seed = {
      threadId,
      pagerThreadId,
      peerThreadId,
      forumId: forum.id,
      landing: await seedLanding(api, peer, {
        post: { id: last.id, position: last.position },
        word,
        peerThreadId,
      }),
    };
  } finally {
    await peer.dispose();
  }
  mkdirSync(dirname(SEED_FILE), { recursive: true });
  writeFileSync(SEED_FILE, JSON.stringify(seed));

  for (const path of [
    "/",
    "/whats-new",
    "/whats-new?tab=hot",
    "/whats-new?tab=media",
    `/forums/${forum.id}`,
    `/threads/${threadId}`,
    "/search?q=phone",
    "/conversations",
    "/conversations/new",
    "/notifications",
    "/account",
    "/login",
    "/register",
    "/cookies",
    "/account/data-saver",
  ]) {
    await page.goto(path);
    await ready(page);
  }
  // The install and notification cards ("Not now" keeps them away for 30 days) would open over the
  // pages the flows measure, so both start out put off. `PROMPTS_KEY` in src/lib/app-prompts.ts.
  await page.goto("/cookies");
  await ready(page);
  await page.evaluate(() => {
    const now = Date.now();
    localStorage.setItem(
      "sermo-app-prompts",
      JSON.stringify({ install: now, push: now }),
    );
  });
  await page.context().storageState({ path: MEMBER_STATE });
});

// The other member, signed in.
async function peerSession(origin: string) {
  const peer = await request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { origin },
  });
  const signIn = await peer.post("/api/auth/sign-in/username", {
    data: { username: PEER, password: PASSWORD },
  });
  if (!signIn.ok()) {
    await peer.dispose();
    throw new Error(`${PEER} could not sign in (${signIn.status()})`);
  }
  return peer;
}

// A thread written by another member, for what needs content that is not the member's own.
async function peerThread(peer: APIRequestContext, forumId: number) {
  const made = await peer.post(`/api/v1/nodes/${forumId}/threads`, {
    data: {
      title: unique("Thread by another member"),
      body: "A post by someone else.",
    },
  });
  if (!made.ok())
    throw new Error(`the thread by ${PEER} was refused (${made.status()})`);
  return ((await made.json()) as { thread: { id: number } }).thread.id;
}

// Writes up to `count` items one after the other and returns their ids, oldest first. A flood
// control may stop it early; the flows that need a long list check its length.
async function writeMany(
  count: number,
  write: (index: number) => ReturnType<Api>,
) {
  const ids: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const made = await write(index);
    if (!made.ok()) break;
    ids.push(((await made.json()) as { id: number }).id);
  }
  return ids;
}

// What the landing flows aim at: a wall longer than a page whose oldest post has more comments
// than a page, a conversation longer than two pages, a quote of the thread's target in the other
// member's thread, and an alert for each target from the other member's reaction to it. Tall
// pictures sit above each target.
async function seedLanding(
  api: Api,
  peer: APIRequestContext,
  given: Pick<LandingSeed, "post" | "word"> & { peerThreadId: number },
): Promise<LandingSeed> {
  const me = (await (await api("/me")).json()) as { user: { id: number } };
  const memberId = me.user.id;
  const other = (await (await peer.get("/api/v1/me")).json()) as {
    user: { id: number };
  };

  // The wall lists newest first: the two posts written after the oldest are drawn above it.
  const wall = await writeMany(30, (index) =>
    api(`/users/${memberId}/profile-posts`, {
      method: "POST",
      data: {
        body:
          index === 1 || index === 2
            ? `Wall post ${index + 1}.\n${picture}`
            : `Wall post ${index + 1}.`,
      },
    }),
  );
  const oldestPostId = wall[0] ?? 0;
  // Comments list oldest first: the two before the target are drawn above it.
  const comments = await writeMany(35, (index) =>
    api(`/profile-posts/${oldestPostId}/comments`, {
      method: "POST",
      data: {
        body:
          index < 2
            ? `Comment ${index + 1}.\n${picture}`
            : `Comment ${index + 1}.`,
      },
    }),
  );

  // The newest post has more comments than a card shows: the feed's card links the rest.
  await writeMany(4, (index) =>
    api(`/profile-posts/${wall.at(-1) ?? 0}/comments`, {
      method: "POST",
      data: { body: `Later comment ${index + 1}.` },
    }),
  );

  // Messages list oldest first on a page: the first two are drawn above the target.
  const started = await api("/conversations", {
    method: "POST",
    data: {
      title: unique("Long conversation"),
      recipientIds: [other.user.id],
      body: `Message 1.\n${picture}`,
    },
  });
  if (!started.ok())
    throw new Error(`the long conversation was refused (${started.status()})`);
  const opened = (await started.json()) as {
    conversation: { id: number };
    message: { id: number };
  };
  const conversationId = opened.conversation.id;
  const messages = [
    opened.message.id,
    ...(await writeMany(49, (index) =>
      api(`/conversations/${conversationId}/messages`, {
        method: "POST",
        data: {
          body:
            index === 0 ? `Message 2.\n${picture}` : `Message ${index + 2}.`,
        },
      }),
    )),
  ];

  // A quote of the target, in another thread, links it by its own address.
  await api(`/threads/${given.peerThreadId}/posts`, {
    method: "POST",
    data: {
      body: `[QUOTE="${USER}, post: ${given.post.id}, member: ${memberId}"]The target.[/QUOTE] Quoted.`,
    },
  });

  const landing: LandingSeed = {
    memberId,
    post: given.post,
    word: given.word,
    wall: {
      oldestPostId,
      newestPostId: wall.at(-1) ?? 0,
      commentId: comments[2] ?? 0,
      posts: wall.length,
      comments: comments.length,
    },
    conversation: {
      id: conversationId,
      messageId: messages[2] ?? 0,
      messages: messages.length,
    },
    alerted: [],
  };

  // The other member reacts to every target, which gives the member an alert for each.
  const types = (await (await peer.get("/api/v1/reaction-types")).json()) as {
    items: {
      id: number;
      isActive: boolean;
      access: string;
      forumIds?: number[] | null;
    }[];
  };
  const like = types.items.find(
    (type) => type.isActive && type.access === "open" && !type.forumIds?.length,
  );
  const targets: [string, number][] = [
    ["post", landing.post.id],
    ["profile_post", landing.wall.oldestPostId],
    ["profile_post", landing.wall.newestPostId],
    ["profile_post_comment", landing.wall.commentId],
    ["conversation_message", landing.conversation.messageId],
  ];
  const reacted: string[] = [];
  for (const [type, id] of targets) {
    if (!like || !id) continue;
    const answer = await peer.put(`/api/v1/reactions/${type}/${id}`, {
      data: { reactionTypeId: like.id },
    });
    if (answer.ok()) reacted.push(`${type}:${id}`);
  }
  // Alerts are written by a background job: wait for them, for a while.
  for (let tries = 0; tries < 30; tries += 1) {
    const list = (await (await api("/notifications?limit=50")).json()) as {
      items: { contentType: string; contentId: number }[];
    };
    const have = new Set(
      list.items.map((item) => `${item.contentType}:${item.contentId}`),
    );
    landing.alerted = reacted.filter((key) => have.has(key));
    if (landing.alerted.length === reacted.length) break;
    await new Promise((done) => setTimeout(done, 1_000));
  }
  return landing;
}
