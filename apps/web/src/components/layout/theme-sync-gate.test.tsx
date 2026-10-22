import { expect, mock, test } from "bun:test";
import { viewerBody } from "@/lib/test-viewer";

let accountTheme: string | null = null;
let signedIn = true;
let cookie: string | undefined;
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) =>
      name === "sermo-account-theme" && cookie !== undefined
        ? { name, value: cookie }
        : undefined,
  }),
}));
mock.module("@/lib/sermo/session", () => ({
  getViewer: async () => {
    const body = viewerBody(signedIn);
    return {
      ...body,
      user: body.user && { ...body.user, theme: accountTheme },
    };
  },
}));
const { ThemeSyncGate } = await import("./theme-sync-gate");
const { ThemeSync } = await import("./theme-sync");

test("a member whose browser does not hold their account theme gets the sync", async () => {
  accountTheme = "dark";
  cookie = undefined;
  expect(await ThemeSyncGate()).toEqual(<ThemeSync theme="dark" />);
  cookie = "light";
  expect(await ThemeSyncGate()).toEqual(<ThemeSync theme="dark" />);
});

test("nothing is drawn when the cookie already holds the account theme, or the account chose none", async () => {
  accountTheme = "dark";
  cookie = "dark";
  expect(await ThemeSyncGate()).toBeNull();
  accountTheme = null;
  cookie = undefined;
  expect(await ThemeSyncGate()).toBeNull();
});

test("a cookie with no account theme behind it is dropped: for a member who chose none and for a guest", async () => {
  cookie = "dark";
  accountTheme = null;
  expect(await ThemeSyncGate()).toEqual(<ThemeSync theme={null} />);
  signedIn = false;
  expect(await ThemeSyncGate()).toEqual(<ThemeSync theme={null} />);
  cookie = undefined;
  expect(await ThemeSyncGate()).toBeNull();
  signedIn = true;
});
