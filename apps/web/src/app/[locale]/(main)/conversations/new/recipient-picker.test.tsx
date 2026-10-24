import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import { RecipientPicker } from "./recipient-picker";

test("the visible Recipients label is tied to the box that finds them", () => {
  const html = renderToStaticMarkup(withIntl(<RecipientPicker />));
  const forId = html.match(/<label[^>]*for="([^"]+)"[^>]*>Recipients<\/label>/);
  const box = html.match(/<input[^>]*type="search"[^>]*>/)?.[0] ?? "";
  expect(forId?.[1]).toBeTruthy();
  expect(box).toContain(`id="${forId?.[1]}"`);
  expect(box).not.toContain("aria-label");
});

test("the recipients stay a group named by the same label", () => {
  const html = renderToStaticMarkup(withIntl(<RecipientPicker />));
  const group = html.match(/<fieldset[^>]*aria-labelledby="([^"]+)"/);
  expect(html).toContain(`id="${group?.[1]}"`);
});
