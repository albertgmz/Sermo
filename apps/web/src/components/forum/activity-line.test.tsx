import { expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createTranslator, IntlProvider } from "use-intl";
import { messagesFor } from "@/i18n/messages";
import type { ActivityView } from "@/lib/sermo/views";
import { ActivityLine, placeText } from "./activity-line";

const AT = "2026-01-01T09:00:00.000Z";
const NOW = new Date("2026-01-01T09:05:00.000Z");

async function html(node: ReactNode, locale: "en" | "es" = "en") {
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

const line = (activity: Partial<ActivityView>, locale?: "en" | "es") =>
  html(
    <ActivityLine
      activity={{ at: AT, hidden: false, place: null, ...activity }}
    />,
    locale,
  );

test("the time, then the page within the hour, its title a link to it", async () => {
  const out = await line({
    place: { kind: "thread", target: { id: 5, title: "Welcome" } },
  });
  expect(out).toContain(`dateTime="${AT}"`);
  expect(out).toContain("5 minutes ago");
  expect(out).toMatch(
    /Viewing thread “<a[^>]*href="\/threads\/5"[^>]*>Welcome<\/a>”/,
  );
  expect(out.indexOf("5 minutes ago")).toBeLessThan(
    out.indexOf("Viewing thread"),
  );
});

test("in Spanish, as XenForo's Spanish reads", async () => {
  const out = await line(
    { place: { kind: "thread", target: { id: 5, title: "Bienvenidos" } } },
    "es",
  );
  expect(out).toContain("hace 5 minutos");
  expect(out).toMatch(
    /Viendo el tema «<a[^>]*href="\/threads\/5"[^>]*>Bienvenidos<\/a>»/,
  );
  const hidden = await line(
    { hidden: true, place: { kind: "search", target: null } },
    "es",
  );
  expect(hidden).toContain("Buscando");
  expect(hidden).toContain("(oculto)");
});

test("no place: only the time", async () => {
  const out = await line({});
  expect(out).toContain("5 minutes ago");
  expect(out).not.toContain("Viewing");
  expect(out).not.toContain(" · ");
});

test("a page the viewer may not see reads as a page, never named", async () => {
  expect(await line({ place: { kind: "page", target: null } })).toContain(
    "Viewing a page",
  );
  // A forum, thread or member without its target is one the backend did not name.
  const unnamed = await line({ place: { kind: "thread", target: null } });
  expect(unnamed).toContain("Viewing a page");
  expect(unnamed).not.toContain("<a");
});

test("a member who hides their online status is marked hidden", async () => {
  const out = await line({ hidden: true });
  expect(out).toContain('data-slot="activity-hidden"');
  expect(out).toContain("(hidden)");
  expect(await line({})).not.toContain("activity-hidden");
});

test("the place as plain text, for a tooltip", async () => {
  const t = createTranslator({
    locale: "es",
    messages: await messagesFor("es"),
    namespace: "forum.activity",
  });
  expect(
    placeText(t, { kind: "member", target: { id: 6, title: "wren" } }),
  ).toBe("Viendo el perfil de «wren»");
  expect(placeText(t, { kind: "forumList", target: null })).toBe(
    "Viendo la lista de foros",
  );
});
