import { expect, test } from "bun:test";
import { expectNoTableScan } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { NotFoundError } from "../../errors";
import { type World, world } from "../feed/fixtures.test";
import { runDueJobs } from "../jobs";
import { readSiteSettings, updateSiteSettings } from "../settings";
import {
  forumMarkdown,
  llmsFullTxt,
  queueSeoEvents,
  registerSeoJobs,
  sitemapEntries,
  threadMarkdown,
} from ".";
import { LLMS_FULL_FORUM_THREADS, MARKDOWN_SQL } from "./markdown";

const BASE = "https://forum.example.test";

const setMin = (w: World, indexMinReplies: number) =>
  updateSiteSettings(w.ctx, w.admin, { indexMinReplies });
const robots = async (w: World, id: number) =>
  (await w.call("seo.thread", GUEST, { threadId: id })).robots;
const listed = (w: World) => [...sitemapEntries(w.ctx, BASE, "thread")].map((row) => row.id);

/** A thread with `replies` visible replies. */
async function threadWith(w: World, title: string, replies: number) {
  const made = await w.thread(w.alice, w.open.id, title);
  for (let n = 0; n < replies; n += 1) await w.reply(w.bob, made.thread.id, `Reply ${n}`);
  return made.thread.id;
}

test("the setting is off by default, so a thread with no reply is indexed", async () => {
  const w = world();
  const id = await threadWith(w, "Alone", 0);
  expect(readSiteSettings(w.ctx).indexMinReplies).toBe(0);
  expect(await robots(w, id)).toBe("index,follow");
  expect(listed(w)).toContain(id);
});

test("a thread with fewer replies than the setting is noindex and not in the sitemap", async () => {
  const w = world();
  const none = await threadWith(w, "No reply", 0);
  const one = await threadWith(w, "One reply", 1);
  setMin(w, 2);
  expect(await robots(w, none)).toBe("noindex,follow");
  expect(await robots(w, one)).toBe("noindex,follow");
  expect(listed(w)).not.toContain(none);
  expect(listed(w)).not.toContain(one);
});

test("a thread with exactly as many replies as the setting is indexed and listed", async () => {
  const w = world();
  const exact = await threadWith(w, "Two replies", 2);
  const more = await threadWith(w, "Three replies", 3);
  setMin(w, 2);
  expect(await robots(w, exact)).toBe("index,follow");
  expect(await robots(w, more)).toBe("index,follow");
  expect(listed(w)).toEqual(expect.arrayContaining([exact, more]));
});

test("a reply that reaches the setting makes the thread indexable", async () => {
  const w = world();
  const id = await threadWith(w, "Growing", 1);
  setMin(w, 2);
  expect(await robots(w, id)).toBe("noindex,follow");
  await w.reply(w.carol, id, "Second reply");
  expect(await robots(w, id)).toBe("index,follow");
  expect(listed(w)).toContain(id);
});

test("a thin thread is still open to members and to the thread read", async () => {
  const w = world();
  const id = await threadWith(w, "Thin", 0);
  setMin(w, 5);
  const read = await w.call("threads.get", w.bob, { threadId: id });
  expect(read.thread.title).toBe("Thin");
});

test("the setting refuses a negative number, a number above 1000 and a fraction", () => {
  const w = world();
  const refusals: [number, string][] = [
    [-1, "too_small"],
    [1001, "too_big"],
    [1.5, "invalid_type"],
  ];
  for (const [value, code] of refusals)
    expect(() => setMin(w, value)).toThrow(
      new RegExp(`"indexMinReplies"[\\s\\S]*${code}|${code}[\\s\\S]*"indexMinReplies"`),
    );
  expect(readSiteSettings(w.ctx).indexMinReplies).toBe(0);
  setMin(w, 1000);
  expect(readSiteSettings(w.ctx).indexMinReplies).toBe(1000);
});

test("a thin thread has no Markdown page and is not in its forum's Markdown list", async () => {
  const w = world();
  const thin = await threadWith(w, "Thin one", 0);
  const full = await threadWith(w, "Full one", 2);
  const list = () => {
    const page = forumMarkdown(w.ctx, BASE, w.open.id, "");
    return "markdown" in page ? page.markdown : "";
  };
  expect(list()).toContain("Thin one");
  setMin(w, 2);
  expect(list()).not.toContain("Thin one");
  expect(list()).toContain("Full one");
  expect(() => threadMarkdown(w.ctx, BASE, thin, "", 1)).toThrow(NotFoundError);
  expect("markdown" in threadMarkdown(w.ctx, BASE, full, "", 1)).toBe(true);
});

test("threads below the setting do not count towards a tag page", async () => {
  const w = world();
  for (const title of ["1", "2", "3"])
    await w.call("threads.create", w.alice, {
      nodeId: w.open.id,
      title,
      body: "Text",
      tags: ["news"],
    });
  const tagRobots = async () => (await w.call("tags.get", GUEST, { name: "news" })).seo.robots;
  expect(await tagRobots()).toBe("index,follow");
  setMin(w, 1);
  expect(await tagRobots()).toBe("noindex,follow");
  expect([...sitemapEntries(w.ctx, BASE, "tag")]).toEqual([]);
  // A member still sees the tag page with its threads.
  expect((await w.call("tags.get", w.bob, { name: "news" })).name).toBe("news");
});

test("IndexNow announces a thread only once it has enough replies", async () => {
  const w = world();
  updateSiteSettings(w.ctx, w.admin, { indexNowKey: "example-key-123", indexMinReplies: 1 });
  const sent: string[] = [];
  registerSeoJobs(w.ctx, (async (_input: unknown, init?: RequestInit) => {
    sent.push(...(JSON.parse(String(init?.body)) as { urlList: string[] }).urlList);
    return new Response("ok");
  }) as typeof fetch);
  const id = await threadWith(w, "Quiet", 0);
  queueSeoEvents(w.ctx);
  await runDueJobs(w.ctx);
  expect(sent.some((url) => url.includes(`/threads/${id}-`))).toBe(false);
  await w.reply(w.bob, id, "Answer");
  queueSeoEvents(w.ctx);
  await runDueJobs(w.ctx);
  expect(sent.some((url) => url.includes(`/threads/${id}-`))).toBe(true);
});

test("a forum with many thin threads still lists its limit of indexable ones", async () => {
  const w = world();
  for (let n = 0; n < 3; n += 1) await threadWith(w, `Old full ${n}`, 1);
  // Newer thin threads would fill the window of the newest ones.
  for (let n = 0; n < LLMS_FULL_FORUM_THREADS + 2; n += 1) await threadWith(w, `New thin ${n}`, 0);
  setMin(w, 1);
  const page = forumMarkdown(w.ctx, BASE, w.open.id, "");
  const text = "markdown" in page ? page.markdown : "";
  for (let n = 0; n < 3; n += 1) expect(text).toContain(`Old full ${n}`);
  expect(text).not.toContain("New thin");
  const full = llmsFullTxt(w.ctx, BASE);
  expect(full).toContain("Old full 0");
  expect(full).not.toContain("New thin");
});

test("the Markdown list with a floor on replies uses the thread feed index", () => {
  const { ctx } = world();
  expectNoTableScan(ctx, MARKDOWN_SQL.forumThreadsMinReplies, [1, 50, 3]);
  const plan = ctx.sqlite
    .prepare<{ detail: string }, [number, number, number]>(
      `EXPLAIN QUERY PLAN ${MARKDOWN_SQL.forumThreadsMinReplies}`,
    )
    .all(1, 50, 3);
  expect(plan.some((row) => row.detail.includes("threads_node_feed"))).toBe(true);
});
