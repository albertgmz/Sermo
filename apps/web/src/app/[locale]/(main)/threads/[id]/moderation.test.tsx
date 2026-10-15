import { afterAll, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { translator, withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
const intlServer = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  ...intlServer,
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
afterAll(() => {
  mock.module("next-intl/server", () => intlServer);
});
const { forumOptions, ModerationMenu } = await import("./moderation");

const node = (id: number, type: string) => ({
  id,
  type,
  title: `Node ${id}`,
  depth: 1,
  icon: { fileId: id, url: `/api/v1/files/${id}` },
  cover: { fileId: id + 100, url: `/api/v1/files/${id + 100}` },
});

test("a forum picker is given ids, titles and depths and no picture of a forum", () => {
  const items = [node(1, "category"), node(2, "forum"), node(3, "forum")];
  const options = forumOptions(items as never, 3);
  expect(options).toEqual([{ id: 2, title: "Node 2", depth: 1 }]);
  expect(JSON.stringify(options)).not.toContain("/api/v1/files");
});

async function menu(state: string, staffPick: boolean) {
  const may = {
    stick: false,
    feature: true,
    lock: false,
    move: false,
    merge: false,
    split: false,
    delete: false,
    attach: false,
    restoreDeleted: false,
    restoreWaiting: false,
    any: true,
  };
  const node = await ModerationMenu({
    thread: {
      id: 7,
      nodeId: 2,
      state,
      isSticky: false,
      isLocked: false,
    } as never,
    may,
    mayRemoveCover: false,
    staffPick,
    selecting: false,
  });
  const stream = await renderToReadableStream(withIntl(node));
  await stream.allReady;
  return new Response(stream).text();
}

test("Feature is offered on a visible thread, Unfeature on a pick, and neither Feature on a hidden thread", async () => {
  expect(await menu("visible", false)).toContain("Feature");
  expect(await menu("visible", true)).toContain("Unfeature");
  expect(await menu("deleted", true)).toContain("Unfeature");
  const hidden = await menu("deleted", false);
  expect(hidden).not.toContain("Feature<");
  expect(hidden).not.toContain("Unfeature");
});
