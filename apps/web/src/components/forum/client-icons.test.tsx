import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

// The component reads its words through the library's hook and the provider of `withIntl`,
// whatever stand-in another suite left in place for it.
const nextIntl = await import("next-intl");
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useTranslations: useIntl.useTranslations,
}));
const { ClientIcons } = await import("./client-icons");

const draw = (client: { browser: string | null; os: string | null }) =>
  renderToStaticMarkup(withIntl(<ClientIcons client={client} />));

test("the label is the browser and system names the backend stored", () => {
  expect(draw({ browser: "Microsoft Edge", os: "Windows" })).toContain(
    'aria-label="Microsoft Edge on Windows"',
  );
  expect(draw({ browser: "Mobile Safari", os: "iOS" })).toContain(
    'aria-label="Mobile Safari on iOS"',
  );
});

test("a name the backend could not parse is shown as unknown", () => {
  expect(draw({ browser: null, os: null })).toContain(
    'aria-label="Unknown browser on unknown system"',
  );
});

test("the icons follow the stored names, a mobile or branded name included", () => {
  const chrome = draw({ browser: "Chrome", os: "Windows" });
  expect(draw({ browser: "Chrome Mobile", os: "Windows" })).toBe(
    chrome.replace("Chrome on", "Chrome Mobile on"),
  );
  expect(draw({ browser: "Microsoft Edge", os: "Windows" })).not.toBe(
    chrome.replace("Chrome on", "Microsoft Edge on"),
  );
  expect(draw({ browser: "Chrome", os: "Mac" })).not.toBe(
    chrome.replace("Windows", "Mac"),
  );
  expect(draw({ browser: "Chrome", os: "GNU/Linux" })).not.toBe(
    draw({ browser: "Chrome", os: "Something else" }).replace(
      "Something else",
      "GNU/Linux",
    ),
  );
});
