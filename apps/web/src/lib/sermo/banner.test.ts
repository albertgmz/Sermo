import { afterEach, beforeEach, expect, test } from "bun:test";
import { bannerApplies, bannerAppliesOrUnknown, forgetBanner } from "./banner";

const realFetch = globalThis.fetch;
let asked: Headers[] = [];
let answer: () => Promise<Response> = async () =>
  Response.json({ show: false });
beforeEach(() => {
  forgetBanner();
  asked = [];
  answer = async () => Response.json({ show: false });
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    asked.push(new Headers(init?.headers));
    return answer();
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const from = (country?: string) => ({
  cookie: "sermo.session_token=tok",
  location: country ? { "cf-ipcountry": country } : {},
});

test("the answer is kept for a minute per country, and the session never travels", async () => {
  expect(await bannerAppliesOrUnknown(from("US"), 1_000)).toBe(false);
  expect(await bannerAppliesOrUnknown(from("us"), 30_000)).toBe(false);
  expect(asked).toHaveLength(1);
  expect(asked[0]?.get("cf-ipcountry")).toBe("US");
  expect(asked[0]?.get("cookie")).toBeNull();
  // Another country is another question; after the minute the first is asked again.
  answer = async () => Response.json({ show: true });
  expect(await bannerAppliesOrUnknown(from("ES"), 31_000)).toBe(true);
  expect(await bannerAppliesOrUnknown(from("US"), 62_000)).toBe(true);
  expect(asked).toHaveLength(3);
});

test("whatever a header holds that is not a country code shares one answer, so the memory is bounded", async () => {
  for (const [at, value] of [
    "",
    "x",
    "United States",
    "<script>",
    "123",
  ].entries())
    await bannerAppliesOrUnknown(from(value), 1_000 + at);
  await bannerAppliesOrUnknown(from(), 1_010);
  expect(asked).toHaveLength(1);
});

test("a failure is unknown, shows the banner, and is tried again after ten seconds", async () => {
  answer = async () => {
    throw new TypeError("connection refused");
  };
  expect(await bannerAppliesOrUnknown(from("US"), 1_000)).toBeNull();
  expect(await bannerAppliesOrUnknown(from("US"), 5_000)).toBeNull();
  expect(asked).toHaveLength(1);
  answer = async () => Response.json({ show: false });
  expect(await bannerAppliesOrUnknown(from("US"), 11_001)).toBe(false);
  expect(asked).toHaveLength(2);
  forgetBanner();
  answer = async () => new Response("down", { status: 503 });
  expect(await bannerApplies(from("US"))).toBe(true);
});

test("an answer that does not come in time is unknown", async () => {
  answer = () => new Promise<Response>(() => {});
  expect(await bannerAppliesOrUnknown(from("US"), 1_000)).toBeNull();
});
