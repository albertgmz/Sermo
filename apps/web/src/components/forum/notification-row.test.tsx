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

// The avatar reads the viewer's settings; the row's words are what is under test.
const avatar = { ...(await import("@/components/forum/user-avatar")) };
mock.module("@/components/forum/user-avatar", () => ({
  ...avatar,
  UserAvatar: () => <span />,
}));

const { NotificationRow } = await import("./notification-row");

afterAll(() => {
  mock.module("@/components/forum/user-avatar", () => avatar);
  mock.module(
    "@/app/[locale]/(main)/notifications/notification-link",
    () => link,
  );
});

test("a staff alert shows its text under the line that names it", () => {
  const html = renderToStaticMarkup(
    withIntl(
      <NotificationRow
        item={{
          id: 2,
          type: "admin.alert",
          contentType: "admin_alert",
          actors: [],
          actorCount: 1,
          contentTitle: null,
          data: { message: "The forum moves tonight" },
          createdAt: "2026-01-01T00:00:00.000Z",
          read: false,
        }}
        href="/notifications"
        member={(id) => ({ id, username: "x" }) as never}
      />,
    ),
  );
  expect(html).toContain("The staff sent you an alert");
  expect(html).toContain("The forum moves tonight");
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

const signup = (actors: string[], actorCount: number) => ({
  id: 3,
  type: "moderator.signup",
  contentType: "user",
  actors: actors.map((username, index) => ({ id: index + 1, username })),
  actorCount,
  contentTitle: null,
  data: {},
  createdAt: "2026-01-01T00:00:00.000Z",
  read: false,
});

const drawSignup = (item: ReturnType<typeof signup>) =>
  renderToStaticMarkup(
    withIntl(
      <NotificationRow
        item={item}
        href="/moderation/signups"
        member={(id) => ({ id, username: "x" }) as never}
      />,
    ),
  ).replace(/<[^>]+>/g, "");

test("the sign-up alert names the newcomers who wait, with the others counted as other grouped alerts do", () => {
  expect(drawSignup(signup(["wren"], 1))).toContain(
    "wren signed up and waits for approval",
  );
  expect(drawSignup(signup(["wren", "robin"], 2))).toContain(
    "wren and robin signed up and wait for approval",
  );
  // The most recent five are named; the count says how many wait in all.
  expect(drawSignup(signup(["a", "b", "c", "d", "e"], 12))).toContain(
    "a and b and 10 others signed up and wait for approval".replace(
      "a and b and",
      "a, b and",
    ),
  );
  // An alert with no one named keeps the plain line.
  expect(drawSignup(signup([], 0))).toContain(
    "A new account is waiting for approval",
  );
});
