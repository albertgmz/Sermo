import { afterAll, afterEach, expect, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { viewerBody } from "@/lib/test-viewer";
import { AWARD } from "../credits/test-fixtures";
import { htmlOf, mockIntl } from "../credits/test-render";
import { fakeBackend } from "../groups/test-backend";

const restore = await mockIntl();
const { AwardList } = await import("./award-list");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(restore);

async function list(items: unknown[]) {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(false)),
    "awards.list": () => Response.json({ items }),
  });
  return htmlOf(
    await AwardList({
      searchParams: Promise.resolve({}),
      addAction: <a href="/admin/awards/new">Add</a>,
    }),
  );
}

const text = messages.adminEconomy.awards;

test("each award is a row leading to its edit page, with its tier and state", async () => {
  const html = await list([
    {
      ...AWARD,
      rule: { match: "all", conditions: [{ criterion: "posts", value: 5 }] },
    },
    { ...AWARD, id: 8, name: "Rookie", tier: "bronze", isActive: false },
  ]);
  for (const id of [7, 8]) expect(html).toContain(`href="/admin/awards/${id}"`);
  expect(html).toContain("Edit Hero");
  expect(html).toContain(text.tiers.gold);
  expect(html).toContain(text.tiers.bronze);
  expect(html).toContain(text.automatic);
  expect(html).toContain(text.inactive);
});

test("each row keeps its delete step and the sweep stays on the page", async () => {
  const html = await list([AWARD]);
  expect(html).toContain('name="id" value="7"');
  expect(html).toContain(text.deleteWarning);
  expect(html).toContain(text.runHeading);
});

test("with no awards the list offers to add one", async () => {
  const html = await list([]);
  expect(html).toContain(text.none);
  expect(html).toContain('href="/admin/awards/new"');
});
