import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

// Another suite replaces the translator with one that fills no placeholders: use the real one.
const intl = { ...(await import("next-intl")) };
const { useTranslations } = await import("use-intl");
mock.module("next-intl", () => ({
  ...intl,
  useLocale: () => "en",
  useTranslations,
}));
afterAll(() => {
  mock.module("next-intl", () => intl);
});
const { Dialog } = await import("@/components/ui/dialog");
const { BlockDialogBody } = await import("./block-dialog");

// What the dialog holds. The box that keeps it over the page is drawn in a portal, which markup
// rendered on the server does not hold.
const draw = (blocking: boolean) =>
  renderToStaticMarkup(
    withIntl(
      <Dialog open>
        <BlockDialogBody
          username="wren"
          blocking={blocking}
          onConfirm={() => {}}
          onClose={() => {}}
        />
      </Dialog>,
    ),
  );

test("blocking asks first and says that the direct messages between the two disappear for both", () => {
  const html = draw(false);
  expect(html).toContain("Block wren?");
  expect(html).toContain(
    "The direct messages between you disappear for both of you.",
  );
  expect(html).toContain("wren gets no notice.");
  expect(html).toContain(">Block<");
  expect(html).toContain(">Cancel<");
});

test("unblocking asks first and says that what the block hid does not come back", () => {
  const html = draw(true);
  expect(html).toContain("Unblock wren?");
  expect(html).toContain("do not come back");
  expect(html).not.toContain("gets no notice");
  expect(html).toContain(">Unblock<");
});
