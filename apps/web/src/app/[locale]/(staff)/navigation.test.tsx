import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import type { NavSection } from "./navigation-data";

let pathname = "/admin";
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => pathname,
}));
const { currentOf, StaffNavigation } = await import("./navigation");

afterAll(() => {
  mock.module("next/navigation", () => navigation);
});

const SECTIONS: NavSection[] = [
  { id: "home", label: "Home", screens: [{ href: "/admin", label: "Home" }] },
  {
    id: "users",
    label: "Users",
    href: "/admin/sections/users",
    screens: [
      { href: "/admin/users", label: "Members" },
      { href: "/admin/settings/warnings", label: "Warnings" },
    ],
  },
  {
    id: "setup",
    label: "Setup",
    href: "/admin/sections/setup",
    screens: [{ href: "/admin/settings", label: "General" }],
  },
  // A landing alone: the overview of moderation for a reader of the moderator log.
  { id: "moderation", label: "Moderation", href: "/moderation", screens: [] },
  // A section drawn without its landing.
  {
    id: "logs",
    label: "Logs",
    screens: [{ href: "/admin/logs/tasks", label: "Background tasks" }],
  },
];

test("the current place is the longest screen or landing the address lies under", () => {
  expect(currentOf("/admin", SECTIONS)?.href).toBe("/admin");
  expect(currentOf("/admin/users/7/groups", SECTIONS)?.href).toBe(
    "/admin/users",
  );
  // A screen of one section under the address of another's screen.
  expect(currentOf("/admin/settings/warnings", SECTIONS)?.section.id).toBe(
    "users",
  );
  expect(currentOf("/admin/settings/seo", SECTIONS)?.section.id).toBe("setup");
  expect(currentOf("/admin/sections/users", SECTIONS)).toEqual({
    href: "/admin/sections/users",
    section: SECTIONS[1],
  });
  expect(currentOf("/moderation", SECTIONS)?.section.id).toBe("moderation");
  expect(currentOf("/admin/nothing", SECTIONS)).toBeUndefined();
});

const render = () =>
  renderToStaticMarkup(
    withIntl(<StaffNavigation sections={SECTIONS} label="Administration" />),
  );

test("the section of the page is open, its heading leads to its landing, its arrow opens or closes it", () => {
  pathname = "/admin/users/7";
  const html = render();
  // The heading's link and the arrow, named after the section.
  expect(html).toContain('href="/admin/sections/users"');
  const arrow = /<button[^>]*aria-label="Screens of Users"[^>]*>/.exec(
    html,
  )?.[0];
  expect(arrow).toContain('aria-expanded="true"');
  expect(arrow).toContain('aria-controls="staff-nav-users"');
  expect(html).toMatch(/<div id="staff-nav-users" class="[^"]*">/);
  expect(html).toMatch(
    /<a[^>]*aria-current="page"[^>]*href="\/admin\/users"|<a[^>]*href="\/admin\/users"[^>]*aria-current="page"/,
  );
  // Another section is closed.
  expect(html).toMatch(/<div id="staff-nav-setup" hidden=""/);
  expect(
    /<button[^>]*aria-label="Screens of Setup"[^>]*>/.exec(html)?.[0],
  ).toContain('aria-expanded="false"');
});

test("on a landing its heading is the current page; a landing alone and the home are plain links", () => {
  pathname = "/admin/sections/setup";
  const html = render();
  const heading = /<a[^>]*href="\/admin\/sections\/setup"[^>]*>/.exec(
    html,
  )?.[0];
  expect(heading).toContain('aria-current="page"');
  expect(html).not.toMatch(/<div id="staff-nav-setup" hidden=""/);
  expect(html).not.toContain("staff-nav-moderation");
  expect(html).toContain('href="/moderation"');
  expect(html).not.toContain("staff-nav-home");
  // Without a landing the whole heading opens the section.
  expect(
    /<button[^>]*aria-controls="staff-nav-logs"[^>]*>/.exec(html)?.[0],
  ).not.toContain("aria-label");
  expect(html.match(/<svg/g)?.length).toBeGreaterThanOrEqual(5);
});
