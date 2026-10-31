import { expect, test } from "bun:test";
import { insertNode } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { NotFoundError } from "../../errors";
import { type World, world } from "../feed/fixtures.test";
import { runDueJobs } from "../jobs";
import { updateSiteSettings } from "../settings";
import {
  forumMarkdown,
  llmsFullTxt,
  llmsTxt,
  queueSeoEvents,
  registerSeoJobs,
  sitemapEntries,
  sitemapIndex,
  threadMarkdown,
} from ".";

const BASE = "https://forum.example.test";

/** A second category with a forum, flagged by nobody. */
function otherForum(w: World) {
  const category = insertNode(w.ctx, { type: "category" });
  return insertNode(w.ctx, { parentId: category.id });
}

const flag = (w: World, nodeId: number, noIndex = true) =>
  w.call("nodes.update", w.admin, { nodeId, settings: { noIndex } });
const nodeRobots = async (w: World, id: number) =>
  (await w.call("seo.node", GUEST, { nodeId: id })).robots;
const threadRobots = async (w: World, id: number) =>
  (await w.call("seo.thread", GUEST, { threadId: id })).robots;
const ids = (w: World, kind: "node" | "thread") =>
  [...sitemapEntries(w.ctx, BASE, kind)].map((row) => row.id);

test("a forum is open to indexing until an admin flags it", async () => {
  const w = world();
  const { thread } = await w.thread(w.alice, w.open.id, "Hello");
  const node = await w.call("nodes.get", GUEST, { nodeId: w.open.id });
  expect(node.node.settings.noIndex).toBe(false);
  expect(await nodeRobots(w, w.open.id)).toBe("index,follow");
  expect(await threadRobots(w, thread.id)).toBe("index,follow");
});

test("a flagged forum and its threads are noindex, and a forum beside it is not", async () => {
  const w = world();
  const other = otherForum(w);
  const mine = await w.thread(w.alice, w.open.id, "Mine");
  const theirs = await w.thread(w.alice, other.id, "Theirs");
  const saved = await flag(w, w.open.id);
  expect(saved.settings.noIndex).toBe(true);
  expect(await nodeRobots(w, w.open.id)).toBe("noindex,follow");
  expect(await threadRobots(w, mine.thread.id)).toBe("noindex,follow");
  expect(await nodeRobots(w, other.id)).toBe("index,follow");
  expect(await threadRobots(w, theirs.thread.id)).toBe("index,follow");
});

test("the flag is read from a sub-forum: the forums under a flagged node inherit it", async () => {
  const w = world();
  const child = insertNode(w.ctx, { parentId: w.open.id });
  const grandchild = insertNode(w.ctx, { parentId: child.id });
  const deep = await w.thread(w.alice, grandchild.id, "Deep");
  await flag(w, w.category.id);
  for (const id of [w.category.id, w.open.id, child.id, grandchild.id])
    expect(await nodeRobots(w, id)).toBe("noindex,follow");
  expect(await threadRobots(w, deep.thread.id)).toBe("noindex,follow");
  // The child's own switch stays off: the flag is inherited, not copied.
  const stored = await w.call("nodes.get", GUEST, { nodeId: child.id });
  expect(stored.node.settings.noIndex).toBe(false);
  await flag(w, w.category.id, false);
  expect(await nodeRobots(w, grandchild.id)).toBe("index,follow");
});

test("members still open a flagged forum and its threads", async () => {
  const w = world();
  const made = await w.thread(w.alice, w.open.id, "Open to read");
  await flag(w, w.open.id);
  const read = await w.call("threads.get", w.bob, { threadId: made.thread.id });
  expect(read.thread.title).toBe("Open to read");
  expect((await w.call("nodes.get", w.bob, { nodeId: w.open.id })).node.id).toBe(w.open.id);
});

test("the sitemaps leave out a flagged forum, its sub-forums and their threads", async () => {
  const w = world();
  const other = otherForum(w);
  const child = insertNode(w.ctx, { parentId: w.open.id });
  const inChild = await w.thread(w.alice, child.id, "In child");
  const inOpen = await w.thread(w.alice, w.open.id, "In open");
  const kept = await w.thread(w.alice, other.id, "Kept");
  expect(ids(w, "node")).toContain(w.open.id);
  expect(ids(w, "thread")).toContain(inOpen.thread.id);
  await flag(w, w.open.id);
  expect(ids(w, "node")).toContain(other.id);
  expect(ids(w, "node")).not.toContain(w.open.id);
  expect(ids(w, "node")).not.toContain(child.id);
  expect(ids(w, "thread")).toEqual([kept.thread.id]);
  expect(ids(w, "thread")).not.toContain(inChild.thread.id);
});

test("threads of a flagged forum do not count towards a tag page", async () => {
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
  expect(ids(w, "node").length).toBeGreaterThan(0);
  expect([...sitemapEntries(w.ctx, BASE, "tag")].map((row) => new URL(row.url).pathname)).toContain(
    "/tags/news",
  );
  await flag(w, w.open.id);
  expect(await tagRobots()).toBe("noindex,follow");
  expect([...sitemapEntries(w.ctx, BASE, "tag")]).toEqual([]);
  expect(sitemapIndex(w.ctx, BASE)).not.toContain("tag-1.xml");
  // A tag page still lists the threads to a member.
  expect((await w.call("tags.get", w.bob, { name: "news" })).name).toBe("news");
});

test("only threads outside a flagged forum make up a tag page", async () => {
  const w = world();
  const other = otherForum(w);
  await flag(w, w.open.id);
  for (const [nodeId, title] of [
    [w.open.id, "hidden 1"],
    [w.open.id, "hidden 2"],
    [other.id, "shown 1"],
    [other.id, "shown 2"],
  ] as const)
    await w.call("threads.create", w.alice, { nodeId, title, body: "Text", tags: ["mixed"] });
  // Four open threads, two of them in a flagged forum: two count, which is below three.
  expect((await w.call("tags.get", GUEST, { name: "mixed" })).seo.robots).toBe("noindex,follow");
  await w.call("threads.create", w.alice, {
    nodeId: other.id,
    title: "shown 3",
    body: "Text",
    tags: ["mixed"],
  });
  expect((await w.call("tags.get", GUEST, { name: "mixed" })).seo.robots).toBe("index,follow");
});

test("llms.txt and the Markdown views leave out a flagged forum", async () => {
  const w = world();
  const other = otherForum(w);
  const made = await w.thread(w.alice, w.open.id, "Flagged thread");
  await w.thread(w.alice, other.id, "Plain thread");
  expect(llmsTxt(w.ctx, BASE)).toContain(`/forums/${w.open.id}-`);
  await flag(w, w.open.id);
  const text = llmsTxt(w.ctx, BASE);
  expect(text).not.toContain(`/forums/${w.open.id}-`);
  expect(text).toContain(`/forums/${other.id}-`);
  expect(() => forumMarkdown(w.ctx, BASE, w.open.id, "")).toThrow(NotFoundError);
  expect(() => threadMarkdown(w.ctx, BASE, made.thread.id, "", 1)).toThrow(NotFoundError);
});

test("llms-full.txt and a parent's Markdown do not list a flagged forum", async () => {
  const w = world();
  insertNode(w.ctx, { parentId: w.category.id, title: "Listed forum" });
  const shut = insertNode(w.ctx, { parentId: w.category.id, title: "Unlisted forum" });
  await flag(w, shut.id);
  const full = llmsFullTxt(w.ctx, BASE);
  expect(full).toContain("Listed forum");
  expect(full).not.toContain("Unlisted forum");
  const parent = forumMarkdown(w.ctx, BASE, w.category.id, "");
  expect("markdown" in parent && parent.markdown).toContain("Listed forum");
  expect("markdown" in parent && parent.markdown).not.toContain("Unlisted forum");
});

test("IndexNow does not announce a thread in a flagged forum", async () => {
  const w = world();
  updateSiteSettings(w.ctx, w.admin, { indexNowKey: "example-key-123" });
  const sent: string[] = [];
  registerSeoJobs(w.ctx, (async (_input: unknown, init?: RequestInit) => {
    sent.push(...(JSON.parse(String(init?.body)) as { urlList: string[] }).urlList);
    return new Response("ok");
  }) as typeof fetch);
  await flag(w, w.open.id);
  const made = await w.thread(w.alice, w.open.id, "Quiet");
  queueSeoEvents(w.ctx);
  await runDueJobs(w.ctx);
  expect(sent.some((url) => url.includes(`/threads/${made.thread.id}-`))).toBe(false);
  expect(sent.some((url) => url.includes(`/forums/${w.open.id}-`))).toBe(false);
});
