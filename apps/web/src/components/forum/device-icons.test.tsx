import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { withIntl } from "@/lib/test-intl";
import esForum from "../../../messages/es/forum.json";

// The component reads its words through the library's hook and the provider of `withIntl`,
// whatever stand-in another suite left in place for it.
const nextIntl = { ...(await import("next-intl")) };
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useTranslations: useIntl.useTranslations,
}));
afterAll(() => {
  mock.module("next-intl", () => nextIntl);
});
const { DeviceIcons } = await import("./device-icons");

type Device = Parameters<typeof DeviceIcons>[0]["device"];
const draw = (device: Device) =>
  renderToStaticMarkup(withIntl(<DeviceIcons device={device} />));
const marks = (html: string) => html.match(/<svg/g)?.length ?? 0;

test("a phone on Android with Chrome: a phone and the Android logo, named on hover", () => {
  const html = draw({ type: "phone", os: "Android", browser: "Chrome" });
  expect(html).toContain('aria-label="Phone"');
  expect(html).toContain('aria-label="Android · Chrome"');
  expect(html).toContain("lucide-smartphone");
  expect(marks(html)).toBe(2);
  expect(html.indexOf('aria-label="Phone"')).toBeLessThan(
    html.indexOf('aria-label="Android · Chrome"'),
  );
});

test("the kinds are a computer, a phone or a tablet, each with its own mark", () => {
  expect(
    draw({ type: "desktop", os: "Windows", browser: "Firefox" }),
  ).toContain("lucide-monitor");
  expect(draw({ type: "tablet", os: "iPadOS", browser: "Safari" })).toContain(
    "lucide-tablet",
  );
});

test("each system has its logo, and one the app does not know a plain screen", () => {
  const logo = (os: string | null) =>
    draw({ type: null, os, browser: null }).replace(/aria-label="[^"]*"/g, "");
  const known = ["Windows", "Android", "iOS", "macOS", "Linux"].map(logo);
  expect(new Set(known).size).toBe(4); // iOS and macOS share the Apple logo
  expect(logo("iOS")).toBe(logo("macOS"));
  expect(logo("Tizen")).toBe(logo(null));
  expect(known).not.toContain(logo(null));
});

test("no kind: the system mark alone; no system: it is named unknown", () => {
  const html = draw({ type: null, os: "Tizen", browser: null });
  expect(marks(html)).toBe(1);
  expect(html).toContain('aria-label="Tizen"');
  expect(draw({ type: "phone", os: null, browser: "Opera" })).toContain(
    'aria-label="Unknown system · Opera"',
  );
});

test("the words are Spanish on a Spanish page", () => {
  const html = renderToStaticMarkup(
    <IntlProvider locale="es" messages={{ forum: esForum }} timeZone="UTC">
      <DeviceIcons device={{ type: "phone", os: null, browser: "Chrome" }} />
    </IntlProvider>,
  );
  expect(html).toContain('aria-label="Móvil"');
  expect(html).toContain('aria-label="Sistema desconocido · Chrome"');
});
