import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
// Other suites replace next-intl for the whole run: use the real hooks, served by a provider.
const nextIntl = { ...(await import("next-intl")) };
const { useFormatter, useLocale, useNow, useTranslations } = await import(
  "use-intl"
);
mock.module("next-intl", () => ({
  ...nextIntl,
  useFormatter,
  useLocale,
  useNow,
  useTranslations,
}));
const link = {
  ...(await import("@/app/[locale]/(main)/notifications/notification-link")),
};
mock.module("@/app/[locale]/(main)/notifications/notification-link", () => ({
  NotificationLink: (props: { href: string; children: React.ReactNode }) => (
    <a href={props.href}>{props.children}</a>
  ),
}));

const { NotificationRow } = await import("./notification-row");

afterAll(() => {
  mock.module(
    "@/app/[locale]/(main)/notifications/notification-link",
    () => link,
  );
});

test("an alert shows the text of its announcement under the title", () => {
  const html = renderToStaticMarkup(
    withIntl(
      <NotificationRow
        item={{
          id: 1,
          type: "announcement",
          contentType: "announcement",
          actors: [],
          actorCount: 0,
          contentTitle: "Maintenance",
          data: { message: "Tonight at ten" },
          createdAt: "2026-01-01T00:00:00.000Z",
          read: false,
        }}
        href="/notifications"
        member={(id) => ({ id, username: "x" }) as never}
      />,
    ),
  );
  expect(html).toContain("Maintenance");
  expect(html).toContain("Tonight at ten");
});

const reaction = {
  id: 2,
  type: "content.reaction",
  contentType: "post",
  actors: [],
  actorCount: 1,
  contentTitle: "Welcome",
  data: { reactionTypeId: 4 },
  createdAt: "2026-01-01T00:00:00.000Z",
  read: false,
};
const member = (id: number) => ({ id, username: "x" }) as never;

test("a reaction alert names the reaction type that was given", () => {
  const html = renderToStaticMarkup(
    withIntl(
      <NotificationRow
        item={reaction}
        href="/threads/1"
        emoji="👑"
        reaction="Crown"
        member={member}
      />,
    ),
  );
  expect(html).toContain("gave your post the Crown reaction 👑 in “Welcome”");
});

test("a reaction alert whose type is gone says a reaction", () => {
  const html = renderToStaticMarkup(
    withIntl(
      <NotificationRow item={reaction} href="/threads/1" member={member} />,
    ),
  );
  expect(html).toContain("gave your post a reaction");
});

test("the alert reads the same in Spanish", async () => {
  const { IntlProvider } = await import("use-intl");
  const es = (await import("../../../messages/es/notifications.json")).default;
  const html = renderToStaticMarkup(
    <IntlProvider locale="es" messages={{ notifications: es }} timeZone="UTC">
      <NotificationRow
        item={reaction}
        href="/threads/1"
        emoji="👑"
        reaction="Corona"
        member={member}
      />
    </IntlProvider>,
  );
  expect(html).toContain(
    "dio a tu mensaje la reacción «Corona» 👑 en «Welcome»",
  );
});

test("a grouped reaction alert does not name one type for several members", () => {
  const html = renderToStaticMarkup(
    withIntl(
      <NotificationRow
        item={{ ...reaction, actors: [], actorCount: 3 }}
        href="/threads/1"
        emoji="👑"
        reaction="Crown"
        member={member}
      />,
    ),
  );
  expect(html).toContain("gave your post a reaction");
  expect(html).not.toContain("Crown");
});
