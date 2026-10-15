import { afterEach, expect, test } from "bun:test";
import { contracts as c } from "@sermo/core";
import { cleanupEconomy, error, setup } from "./economy-fixtures.test";

afterEach(cleanupEconomy);

async function forumWithThread() {
  const f = await setup();
  const forum = await f.send("POST", "/nodes", f.admin.auth, {
    parentId: null,
    type: "forum",
    title: "General",
  });
  expect(forum.status).toBe(201);
  const nodeId = ((await forum.json()) as { id: number }).id;
  const created = await f.send("POST", `/nodes/${nodeId}/threads`, f.member.auth, {
    title: "Polled",
    body: "Opening",
  });
  expect(created.status).toBe(201);
  const threadId = ((await created.json()) as { thread: { id: number } }).thread.id;
  return { f, threadId };
}

test("the polling reads are routes: conversation messages after an id, thread posts after a position, the feed count", async () => {
  const { f, threadId } = await forumWithThread();
  const reply = await f.send("POST", `/threads/${threadId}/posts`, f.other.auth, { body: "Hi" });
  expect(reply.status).toBe(201);

  const posts = await f.api(
    c.postsList,
    "GET",
    `/threads/${threadId}/posts?afterPosition=0`,
    f.member.auth,
  );
  expect(posts.items.map((post) => post.position)).toEqual([1]);
  expect(
    (await f.api(c.postsList, "GET", `/threads/${threadId}/posts?afterPosition=1`, {})).items,
  ).toEqual([]);
  await error(
    f.send("GET", `/threads/${threadId}/posts?afterPosition=-1`, f.member.auth),
    400,
    "validation",
  );

  const started = await f.api(
    c.conversationsCreate,
    "POST",
    "/conversations",
    f.member.auth,
    { title: "Chat", recipientIds: [f.other.id], body: "first" },
    201,
  );
  const id = started.conversation.id;
  const messages = (query: string, auth = f.other.auth) =>
    f.api(c.conversationsListMessages, "GET", `/conversations/${id}/messages${query}`, auth);
  expect((await messages(`?afterMessageId=${started.message.id}`)).items).toEqual([]);
  await f.api(
    c.conversationsReply,
    "POST",
    `/conversations/${id}/messages`,
    f.member.auth,
    { body: "second" },
    201,
  );
  expect((await messages(`?afterMessageId=${started.message.id}`)).items).toHaveLength(1);
  await error(
    f.send("GET", `/conversations/${id}/messages?afterMessageId=1`, f.admin.auth),
    404,
    "not_found",
  );

  const since = new Date(0).toISOString();
  for (const auth of [f.member.auth, {}])
    expect(await f.api(c.feedNewCount, "GET", `/feed/new-count?since=${since}`, auth)).toEqual({
      count: 1,
      more: false,
    });
  await error(
    f.send("GET", `/feed/new-count?scope=following&since=${since}`),
    401,
    "unauthenticated",
  );
  await error(f.send("GET", "/feed/new-count"), 400, "validation");
});

test("the default read limit holds the polling schedule of several tabs with room to spare", async () => {
  const { f, threadId } = await forumWithThread();
  const started = await f.api(
    c.conversationsCreate,
    "POST",
    "/conversations",
    f.member.auth,
    { title: "Chat", recipientIds: [f.other.id], body: "first" },
    201,
  );
  const since = new Date(0).toISOString();
  const poll = (path: string, auth: Record<string, string>) => f.send("GET", path, auth);
  // One minute of one tab: the open conversation every 3 s, the thread's last page every 10 s,
  // the feed every 30 s, the badges every 60 s. Three tabs of it.
  const tab = (auth: Record<string, string>) => [
    ...Array.from({ length: 20 }, () =>
      poll(
        `/conversations/${started.conversation.id}/messages?afterMessageId=${started.message.id}`,
        auth,
      ),
    ),
    ...Array.from({ length: 6 }, () => poll(`/threads/${threadId}/posts?afterPosition=0`, auth)),
    ...Array.from({ length: 2 }, () => poll(`/feed/new-count?since=${since}`, auth)),
    poll("/me/counters", auth),
  ];
  const member = await Promise.all([
    ...tab(f.member.auth),
    ...tab(f.member.auth),
    ...tab(f.member.auth),
  ]);
  expect(member.map((response) => response.status)).toEqual(member.map(() => 200));
  const left = Number(
    (await poll("/me/counters", f.member.auth)).headers.get("ratelimit-remaining"),
  );
  expect(left).toBeGreaterThan(150);

  // A guest has the feed and the thread: far less.
  const guest = await Promise.all([
    ...Array.from({ length: 3 * 6 }, () => poll(`/threads/${threadId}/posts?afterPosition=0`, {})),
    ...Array.from({ length: 3 * 2 }, () => poll(`/feed/new-count?since=${since}`, {})),
  ]);
  expect(guest.map((response) => response.status)).toEqual(guest.map(() => 200));
});
