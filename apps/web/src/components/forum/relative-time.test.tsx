import { expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToReadableStream, renderToString } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { messagesFor } from "@/i18n/messages";
import { LiveAge } from "./live-age";
import { RelativeTime } from "./relative-time";
import { StaticRelativeTime } from "./relative-time-static";

const AT = "2026-10-30T11:55:00.000Z";
const NOW = new Date("2026-10-30T12:00:00.000Z");

async function html(node: ReactNode, locale: "en" | "es") {
  const stream = await renderToReadableStream(
    <IntlProvider
      locale={locale}
      messages={await messagesFor(locale)}
      timeZone="UTC"
      now={NOW}
    >
      {node}
    </IntlProvider>,
  );
  await stream.allReady;
  return new Response(stream).text();
}

test("a moment shows its age, the full date in the tooltip and ISO in dateTime", async () => {
  const en = await html(<RelativeTime date={AT} />, "en");
  expect(en).toContain(`dateTime="${AT}"`);
  expect(en).toContain('title="Oct 30, 2026 at 11:55 AM"');
  expect(en).toContain(">5 minutes ago</time>");
  const es = await html(<RelativeTime date={AT} />, "es");
  expect(es).toContain("hace 5 minutos");
  expect(es).toContain("30 oct 2026 a las");
});

test("under a minute reads as just now in both languages", async () => {
  const at = "2026-10-30T11:59:30.000Z";
  expect(await html(<RelativeTime date={at} />, "en")).toContain("just now");
  expect(await html(<RelativeTime date={at} />, "es")).toContain("ahora mismo");
});

test("the first render uses the given now, not the clock, so server and browser agree", () => {
  const draw = () =>
    renderToString(
      <IntlProvider locale="es" messages={{}} timeZone="UTC">
        <LiveAge date={AT} now={NOW.getTime()} justNow="ahora mismo" />
      </IntlProvider>,
    );
  const server = draw();
  const browser = draw();
  expect(server).toBe("hace 5 minutos");
  expect(browser).toBe(server);
});

test("the static form writes the same markup and text as the live one", async () => {
  for (const locale of ["en", "es"] as const) {
    const live = await html(<RelativeTime date={AT} />, locale);
    const fixed = await html(<StaticRelativeTime date={AT} />, locale);
    expect(fixed).toBe(live);
  }
});
