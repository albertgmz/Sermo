import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { request } from "@playwright/test";
import {
  expect,
  MEMBER_STATE,
  PASSWORD,
  PEER,
  ready,
  rejectCookies,
  SEED_FILE,
  type Seed,
  test as setup,
  signInWith,
  USER,
  unique,
} from "./fixtures";

// Signs the member in once through the sign-in form and keeps the session (and the answer to the
// cookie banner) for the member's flows, makes one thread long enough to have three pages, and
// opens the main pages once so a development server has compiled them before the flows run.
setup("sign in, seed and warm up", async ({ page }) => {
  setup.setTimeout(480_000);
  await page.goto("/login");
  await rejectCookies(page);
  await ready(page);
  await signInWith(page);
  await expect(
    page.getByRole("button", { name: "Account menu" }),
  ).toBeVisible();

  const origin = new URL(page.url()).origin;
  const api = (path: string, init?: { method: string; data: unknown }) =>
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
  let posts = 1;
  for (let index = 0; index < 45; index += 1) {
    const reply = await api(`/threads/${threadId}/posts`, {
      method: "POST",
      data: { body: `Reply number ${index + 1} of the phone check.` },
    });
    if (!reply.ok()) break;
    posts += 1;
  }
  // Tests open `?page=3`, which needs 41 posts at 20 a page.
  if (posts < 41)
    throw new Error(`only ${posts} posts could be written to the long thread`);
  const seed: Seed = {
    threadId,
    peerThreadId: await peerThread(origin, forum.id),
    forumId: forum.id,
  };
  mkdirSync(dirname(SEED_FILE), { recursive: true });
  writeFileSync(SEED_FILE, JSON.stringify(seed));

  for (const path of [
    "/",
    "/?tab=hot",
    "/?tab=media",
    "/forums",
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
    "/lite",
  ]) {
    await page.goto(path);
    await ready(page);
  }
  await page.context().storageState({ path: MEMBER_STATE });
});

// A thread written by another member, for what needs content that is not the member's own.
async function peerThread(origin: string, forumId: number) {
  const peer = await request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { origin },
  });
  try {
    const signIn = await peer.post("/api/auth/sign-in/username", {
      data: { username: PEER, password: PASSWORD },
    });
    if (!signIn.ok())
      throw new Error(`${PEER} could not sign in (${signIn.status()})`);
    const made = await peer.post(`/api/v1/nodes/${forumId}/threads`, {
      data: {
        title: unique("Thread by another member"),
        body: "A post by someone else.",
      },
    });
    if (!made.ok())
      throw new Error(`the thread by ${PEER} was refused (${made.status()})`);
    return ((await made.json()) as { thread: { id: number } }).thread.id;
  } finally {
    await peer.dispose();
  }
}
