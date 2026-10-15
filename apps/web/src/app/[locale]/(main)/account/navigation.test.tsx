import { expect, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { withIntl } from "@/lib/test-intl";
import { AccountLinks } from "./navigation";

async function markup(element: React.ReactNode) {
  return new Response(await renderToReadableStream(withIntl(element))).text();
}

test("the links group lists the other account screens from the navigation, not the screen it is on", async () => {
  const html = await markup(<AccountLinks />);
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  expect(hrefs).toEqual([
    "/account/bookmarks",
    "/account/privacy",
    "/account/notifications",
    "/account/preferences",
    "/account/permissions",
    "/account/data-saver",
    "/account/security",
  ]);
  expect(html).toContain(messages.account.navigation.privacy);
  expect(html).toContain(messages.lite.navigation.label);
  expect(html).toContain(messages.account.profile.moreGroup);
});
