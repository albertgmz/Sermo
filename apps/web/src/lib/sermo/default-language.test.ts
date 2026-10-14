import { afterEach, beforeEach, expect, test } from "bun:test";
import { siteBody } from "@/lib/test-bodies";

// A private copy of the module: another suite may replace the real one for the proxy.
const source = "./default-language.ts?real";
const { siteDefaultLanguage, forgetDefaultLanguage } = (await import(
  source
)) as typeof import("./default-language");

const realFetch = globalThis.fetch;
let asked = 0;
let answer: () => Promise<Response> = async () =>
  Response.json(siteBody({ defaultLanguage: "es" }));

beforeEach(() => {
  asked = 0;
  forgetDefaultLanguage();
  globalThis.fetch = (async () => {
    asked += 1;
    return answer();
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("the first read is waited for and its language is used", async () => {
  expect(await siteDefaultLanguage(1_000)).toBe("es");
  expect(asked).toBe(1);
});

test("the value is kept for a minute, then read again in the background", async () => {
  expect(await siteDefaultLanguage(1_000)).toBe("es");
  answer = async () => Response.json(siteBody({ defaultLanguage: "en" }));
  expect(await siteDefaultLanguage(60_000)).toBe("es");
  expect(asked).toBe(1);
  // Stale: the last known value answers at once, and the new one is there afterwards.
  expect(await siteDefaultLanguage(62_000)).toBe("es");
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(asked).toBe(2);
  expect(await siteDefaultLanguage(62_001)).toBe("en");
  answer = async () => Response.json(siteBody({ defaultLanguage: "es" }));
});

test("a failed read gives English, never throws, and is tried again soon", async () => {
  answer = async () => {
    throw new TypeError("connection refused");
  };
  expect(await siteDefaultLanguage(1_000)).toBe("en");
  expect(await siteDefaultLanguage(5_000)).toBe("en");
  expect(asked).toBe(1);
  answer = async () => Response.json(siteBody({ defaultLanguage: "es" }));
  expect(await siteDefaultLanguage(12_000)).toBe("es");
  expect(asked).toBe(2);
});

test("a failed read keeps the last known value", async () => {
  expect(await siteDefaultLanguage(1_000)).toBe("es");
  answer = async () => new Response("down", { status: 503 });
  await siteDefaultLanguage(70_000);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(await siteDefaultLanguage(70_001)).toBe("es");
});

test("a language the web app does not speak is ignored", async () => {
  answer = async () => Response.json({ ...siteBody(), defaultLanguage: "xx" });
  expect(await siteDefaultLanguage(1_000)).toBe("en");
});
