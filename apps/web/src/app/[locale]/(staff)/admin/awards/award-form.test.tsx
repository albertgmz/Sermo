import { afterAll, afterEach, expect, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { viewerBody } from "@/lib/test-viewer";
import { AWARD } from "../credits/test-fixtures";
import { htmlOf, mockIntl } from "../credits/test-render";
import { fakeBackend } from "../groups/test-backend";

const restore = await mockIntl();
const { AwardFormFields } = await import("./award-form");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(restore);

const text = messages.adminEconomy.awards.form;

async function form(award?: Parameters<typeof AwardFormFields>[0]["award"]) {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(true)),
    "criteria.list": () =>
      Response.json({
        items: [],
        groups: [],
        awards: [],
        creditRules: [],
        reactionTypes: [],
      }),
    "shopCategories.list": () => Response.json({ items: [] }),
  });
  return htmlOf(await AwardFormFields({ award }));
}

test("the icon is chosen from the site's icons, not typed", async () => {
  const html = await form();
  expect(html).toContain('name="icon" value=""');
  expect(html).not.toContain('<input id="award-new-icon"');
  expect(html).toMatch(/<button[^>]*id="award-new-icon"/);
  expect(html).toContain(messages.ui.iconPicker.none);
  expect(html).toContain(text.icon);
});

test("an award that has an icon opens with it chosen and named", async () => {
  const html = await form({ ...AWARD, icon: "shield-check" } as never);
  expect(html).toContain('name="icon" value="shield-check"');
  expect(html).toContain(messages.ui.iconPicker.labels["shield-check"]);
});
