import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import type { LiteState } from "@/lib/lite-preferences";
import { memberDevice } from "@/lib/test-device";
import { withIntl } from "@/lib/test-intl";
import esForum from "../../../messages/es/forum.json";

// The component reads its words through the library's hook and the provider of `withIntl`,
// whatever stand-in another suite left in place for it; the LITE choice comes from the stand-in
// below instead of a cookie.
const nextIntl = { ...(await import("next-intl")) };
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useTranslations: useIntl.useTranslations,
}));
let lite: LiteState = { master: false, blocked: [] };
const liteMode = { ...(await import("@/lib/lite-mode")) };
mock.module("@/lib/lite-mode", () => ({
  ...liteMode,
  getLiteState: async () => lite,
}));
afterAll(() => {
  mock.module("next-intl", () => nextIntl);
  mock.module("@/lib/lite-mode", () => liteMode);
});
const { DeviceIcons } = await import("./device-icons");

beforeEach(() => {
  lite = { master: false, blocked: [] };
});

type Device = NonNullable<Parameters<typeof DeviceIcons>[0]["device"]>;
const samsung = memberDevice({
  type: "phone",
  deviceType: "smartphone",
  brand: "Samsung",
  os: "Android",
  osCode: "AND",
  osVersion: "14",
  osFamily: "Android",
  browser: "Chrome",
  browserVersion: "132.0.0.0",
});
const draw = async (device: Device | null | undefined, wrap = withIntl) =>
  renderToStaticMarkup(wrap(await DeviceIcons({ device })));
const buttons = (html: string) => html.match(/<button[^>]*>/g) ?? [];

test("two icons, the device's type then its system, each named by its words", async () => {
  const html = await draw(samsung);
  const [type, system] = buttons(html);
  expect(type).toContain('aria-label="Smartphone — Samsung"');
  expect(system).toContain('aria-label="Android 14 · Chrome 132"');
  expect(html).toMatch(
    /mask:url\(&quot;[^&]*\/devices\/smartphone\.svg&quot;\)/,
  );
  expect(html).toMatch(
    /background-image:url\(&quot;[^&]*\/os\/AND\.svg&quot;\)/,
  );
  // The words of the popover are the icon's name.
  expect(html).toContain(">Smartphone — Samsung</span>");
  expect(html).toContain(">Android 14 · Chrome 132</span>");
});

test("each icon is a button that opens its own popover, reached by Tab, with its size set", async () => {
  const html = await draw(samsung);
  const ids = buttons(html).map(
    (tag) => /popovertarget="([^"]+)"/i.exec(tag)?.[1],
  );
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
  for (const id of ids) {
    expect(html).toContain(`id="${id}" popover="auto"`);
    // The popover is placed by the icon that opens it.
    expect(html).toContain(`anchor-name:--${id}`);
    expect(html).toContain(`position-anchor:--${id}`);
  }
  for (const tag of buttons(html)) {
    expect(tag).toContain('type="button"');
    expect(tag).not.toContain("tabindex");
    expect(tag).not.toContain("disabled");
  }
  // The picture adds no name of its own and keeps its box before it loads.
  const pictures = html.match(/<span aria-hidden="true"[^>]*>/g) ?? [];
  expect(pictures).toHaveLength(2);
  for (const picture of pictures) expect(picture).toContain("size-4");
  // A second render cannot reuse the ids (a member card is rendered on its own).
  const again = await draw(samsung);
  for (const id of ids) expect(again).not.toContain(`id="${id}"`);
});

test("nothing is drawn when the device is absent", async () => {
  expect(await draw(undefined)).toBe("");
  expect(await draw(null)).toBe("");
});

test("an unknown system shows matomo's unknown icon in a dashed box; a Linux system without an icon shows Tux", async () => {
  const unknown = await draw(memberDevice({ os: "macOS", browser: "Safari" }));
  expect(unknown).toMatch(/border-dashed[^>]*\/os\/UNK\.webp/);
  expect(unknown).toContain('aria-label="macOS · Safari"');
  expect(unknown).toContain('aria-label="Unknown device"');
  const alpine = await draw(
    memberDevice({
      deviceType: "desktop",
      os: "Alpine Linux",
      osCode: "ALP",
      osFamily: "GNU/Linux",
    }),
  );
  expect(alpine).toContain("/os/LIN.webp");
});

test("a dark glyph of one colour takes the colour of the text (both themes); a coloured logo is drawn as it is", async () => {
  const html = await draw(samsung);
  const [type, system] = html.match(/<span aria-hidden="true"[^>]*>/g) ?? [];
  expect(type).toContain("bg-current");
  expect(type).toContain("mask:");
  expect(system).not.toContain("bg-current");
  expect(system).toContain("background-image:");
  // iOS is a black word mark in matomo-icons.
  expect(await draw(memberDevice({ osCode: "IOS", os: "iOS" }))).toMatch(
    /mask:url\(&quot;[^&]*\/os\/IOS\.svg/,
  );
});

test("the words show on hover and on a press; keyboard focus alone does not keep a preview Escape cannot close", async () => {
  const html = await draw(samsung);
  const tips = html.match(/<span id="[^"]+" popover="auto"[^>]*>/g) ?? [];
  expect(tips).toHaveLength(2);
  for (const tip of tips) {
    expect(tip).toContain("open:block");
    expect(tip).toContain("peer-hover:block");
    expect(tip).not.toContain("focus");
  }
});

test("a dark logo keeps a light edge on the dark theme", async () => {
  const debian = await draw(
    memberDevice({ deviceType: "desktop", os: "Debian", osCode: "DEB" }),
  );
  expect(debian).toMatch(/drop-shadow[^"]*"[^>]*\/os\/DEB\.webp/);
  expect(await draw(samsung)).not.toContain("drop-shadow");
});

test("while LITE blocks pictures, a placeholder stands in and the words stay", async () => {
  lite = { master: false, blocked: ["avatars"] };
  const html = await draw(samsung);
  expect(html).not.toContain("url(");
  expect(html).toContain('data-slot="lite-placeholder"');
  expect(html).toContain('aria-label="Smartphone — Samsung"');
});

test("the words are Spanish on a Spanish page", async () => {
  const html = await draw(samsung, (node) => (
    <IntlProvider locale="es" messages={{ forum: esForum }} timeZone="UTC">
      {node}
    </IntlProvider>
  ));
  expect(html).toContain('aria-label="Móvil — Samsung"');
  expect(html).toContain('aria-label="Android 14 · Chrome 132"');
});
