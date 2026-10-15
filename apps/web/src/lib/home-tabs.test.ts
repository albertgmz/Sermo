import { expect, test } from "bun:test";
import { barOf, HOME_TABS, homeHref, openTab, tabParam } from "./home-tabs";

test("the tabs are latest, hot, following, forums and media, in that order", () => {
  expect([...HOME_TABS]).toEqual([
    "latest",
    "hot",
    "following",
    "forums",
    "media",
  ]);
});

test("the address names a tab or none: top is no longer a name", () => {
  expect(tabParam("forums")).toBe("forums");
  expect(tabParam(["media", "hot"])).toBe("media");
  expect(tabParam("top")).toBeNull();
  expect(tabParam("nonsense")).toBeNull();
  expect(tabParam(undefined)).toBeNull();
});

test("every tab has a stable address that names it", () => {
  expect(HOME_TABS.map((tab) => homeHref(tab))).toEqual([
    "/?tab=latest",
    "/?tab=hot",
    "/?tab=following",
    "/?tab=forums",
    "/?tab=media",
  ]);
  expect(homeHref("media", "a b")).toBe("/?tab=media&cursor=a+b");
});

test("a tab in the address wins; otherwise the visitor's default opens", () => {
  const base = { home: "forums", signedIn: true } as const;
  expect(openTab({ ...base, named: "hot" })).toBe("hot");
  expect(openTab({ ...base, named: null })).toBe("forums");
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
  ).toEqual({ bar: ["latest", "hot", "following"], more: ["forums", "media"] });
  expect(
    barOf({ active: "forums", fallback: "forums", signedIn: true }),
  ).toEqual({ bar: ["latest", "hot", "forums"], more: ["following", "media"] });
  expect(barOf({ active: "media", fallback: "media", signedIn: true })).toEqual(
    {
      bar: ["latest", "hot", "media"],
      more: ["following", "forums"],
    },
  );
});

test("the tab that is open is always on the bar, in place of the last one that is not the default", () => {
  expect(
    barOf({ active: "media", fallback: "latest", signedIn: true }),
  ).toEqual({ bar: ["latest", "hot", "media"], more: ["following", "forums"] });
  // The default is the last on the bar and keeps its place.
  expect(
    barOf({ active: "forums", fallback: "media", signedIn: true }),
  ).toEqual({ bar: ["latest", "forums", "media"], more: ["hot", "following"] });
  expect(barOf({ active: "hot", fallback: "forums", signedIn: true })).toEqual({
    bar: ["latest", "hot", "forums"],
    more: ["following", "media"],
  });
});

test("a guest has no following tab, so the bar fills with the next ones", () => {
  expect(
    barOf({ active: "latest", fallback: "latest", signedIn: false }),
  ).toEqual({ bar: ["latest", "hot", "forums"], more: ["media"] });
  expect(
    barOf({ active: "media", fallback: "media", signedIn: false }),
  ).toEqual({
    bar: ["latest", "hot", "media"],
    more: ["forums"],
  });
  // A default a guest cannot have is Latest.
  expect(
    barOf({ active: "latest", fallback: "following", signedIn: false }).bar,
  ).toContain("latest");
});
