import { expect, test } from "bun:test";
import {
  barOf,
  HOME_TABS,
  homeHref,
  openTab,
  phoneBarOf,
  tabParam,
} from "./home-tabs";

test("the tabs are latest, hot, following and media, in that order: the forums are the home page", () => {
  expect([...HOME_TABS]).toEqual(["latest", "hot", "following", "media"]);
});

test("the address names a tab or none: top and forums are no longer names", () => {
  expect(tabParam("hot")).toBe("hot");
  expect(tabParam(["media", "hot"])).toBe("media");
  expect(tabParam("forums")).toBeNull();
  expect(tabParam("top")).toBeNull();
  expect(tabParam("nonsense")).toBeNull();
  expect(tabParam(undefined)).toBeNull();
});

test("every tab has a stable address on the feed page that names it", () => {
  expect(HOME_TABS.map((tab) => homeHref(tab))).toEqual([
    "/whats-new?tab=latest",
    "/whats-new?tab=hot",
    "/whats-new?tab=following",
    "/whats-new?tab=media",
  ]);
  expect(homeHref("media", "a b")).toBe("/whats-new?tab=media&cursor=a+b");
});

test("a tab in the address wins; otherwise the visitor's default opens", () => {
  const base = { home: "media", signedIn: true } as const;
  expect(openTab({ ...base, named: "hot" })).toBe("hot");
  expect(openTab({ ...base, named: null })).toBe("media");
});

test("a guest is never opened on following, whoever asked for it", () => {
  expect(openTab({ named: "following", home: "hot", signedIn: false })).toBe(
    "latest",
  );
  expect(openTab({ named: null, home: "following", signedIn: false })).toBe(
    "latest",
  );
  expect(openTab({ named: "following", home: "hot", signedIn: true })).toBe(
    "following",
  );
});

test("the bar holds the default and the first tabs of the order, three in all", () => {
  expect(
    barOf({ active: "latest", fallback: "latest", signedIn: true }),
  ).toEqual({ bar: ["latest", "hot", "following"], more: ["media"] });
  expect(barOf({ active: "media", fallback: "media", signedIn: true })).toEqual(
    { bar: ["latest", "hot", "media"], more: ["following"] },
  );
});

test("the tab that is open is always on the bar, in place of the last one that is not the default", () => {
  expect(
    barOf({ active: "media", fallback: "latest", signedIn: true }),
  ).toEqual({ bar: ["latest", "hot", "media"], more: ["following"] });
  // The default is the last on the bar and keeps its place.
  expect(
    barOf({ active: "following", fallback: "media", signedIn: true }),
  ).toEqual({ bar: ["latest", "following", "media"], more: ["hot"] });
  expect(barOf({ active: "hot", fallback: "media", signedIn: true })).toEqual({
    bar: ["latest", "hot", "media"],
    more: ["following"],
  });
});

test("a guest has no following tab, so every other tab fits on the bar", () => {
  expect(
    barOf({ active: "latest", fallback: "latest", signedIn: false }),
  ).toEqual({ bar: ["latest", "hot", "media"], more: [] });
  expect(
    barOf({ active: "media", fallback: "media", signedIn: false }),
  ).toEqual({ bar: ["latest", "hot", "media"], more: [] });
  // A default a guest cannot have is Latest.
  expect(
    barOf({ active: "latest", fallback: "following", signedIn: false }).bar,
  ).toContain("latest");
});

test("on a phone the bar holds every tab but Media, which is in More, whatever the default", () => {
  expect(phoneBarOf({ active: "latest", signedIn: true })).toEqual({
    bar: ["latest", "hot", "following"],
    more: ["media"],
  });
  expect(phoneBarOf({ active: "following", signedIn: true })).toEqual({
    bar: ["latest", "hot", "following"],
    more: ["media"],
  });
  // A guest has no Following.
  expect(phoneBarOf({ active: "hot", signedIn: false })).toEqual({
    bar: ["latest", "hot"],
    more: ["media"],
  });
});

test("on a phone Media open is on the bar, and there is nothing left for More", () => {
  expect(phoneBarOf({ active: "media", signedIn: true })).toEqual({
    bar: ["latest", "hot", "following", "media"],
    more: [],
  });
  expect(phoneBarOf({ active: "media", signedIn: false })).toEqual({
    bar: ["latest", "hot", "media"],
    more: [],
  });
});
