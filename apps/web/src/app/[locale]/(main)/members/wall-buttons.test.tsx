import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

// The address the browser is at, as the router says it.
let path = "/members/54-wren/posts";
let search = "page=2";
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => path,
  useSearchParams: () => new URLSearchParams(search),
}));
// The address the action is bound to go back to.
const bound: unknown[][] = [];
const actions = await import("@/app/[locale]/(main)/members/actions");
mock.module("@/app/[locale]/(main)/members/actions", () => ({
  ...actions,
  setFollowing: {
    bind: (...args: unknown[]) => {
      bound.push(args);
      return async () => ({});
    },
  },
}));
afterAll(() => {
  mock.module("next/navigation", () => navigation);
  mock.module("@/app/[locale]/(main)/members/actions", () => actions);
});

const { FollowButton } = await import("./wall-buttons");

function returnTo() {
  bound.length = 0;
  renderToStaticMarkup(
    withIntl(
      <FollowButton user={{ id: 54, username: "wren" }} following={false} />,
    ),
  );
  return bound.at(-1)?.[2];
}

test("Follow goes back to the address the browser is at: the same tab, the same spelling", () => {
  expect(returnTo()).toBe("/members/54-wren/posts?page=2");
  // Entered by a member link with no slug: the profile keeps that spelling.
  path = "/members/54/about";
  search = "";
  expect(returnTo()).toBe("/members/54/about");
  path = "/members/54";
  expect(returnTo()).toBe("/members/54");
});
