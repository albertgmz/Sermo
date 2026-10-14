import { afterAll, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
afterAll(() => {
  mock.module("next/navigation", () => navigation);
});
const { MonthHero } = await import("./standing");

const winner = {
  year: 2026,
  month: 1,
  posts: 3,
  reactions: 4,
  referrals: 0,
  points: 12.5,
  card: {
    id: 3,
    username: "ember",
    avatar: null,
    frame: null,
    nameColor: null,
    nameIcon: null,
    title: "",
    badges: [],
    level: 1,
    restricted: false,
  },
};

async function html(leading?: boolean) {
  const stream = await renderToReadableStream(
    withIntl(<MonthHero winner={winner} leading={leading} />),
  );
  return new Response(stream).text();
}

test("the hero of a finished month is headed Member of the month", async () => {
  const page = await html();
  expect(page).toContain(messages.forum.standing.heading);
  expect(page).not.toContain(messages.forum.standing.leadingHeading);
});

test("the hero of the running month says who leads it", async () => {
  const page = await html(true);
  expect(page).toContain(messages.forum.standing.leadingHeading);
  expect(page).not.toContain(`>${messages.forum.standing.heading}<`);
  expect(page).toContain("ember");
});
