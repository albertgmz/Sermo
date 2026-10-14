import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
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
