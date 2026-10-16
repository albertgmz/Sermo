import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  consentCookie,
  cookieHeader,
  findChrome,
  folderName,
  formatSummary,
  median,
  ownPath,
  pageCount,
  parseLighthouseArgs,
  pickForum,
  pickThread,
  type ReportFacts,
  searchWords,
  summarise,
} from "./lighthouse-lib";

describe("arguments", () => {
  test("default to the staging site, before the banner is answered, every page, three runs", () => {
    const args = parseLighthouseArgs([]);
    expect(args.url).toBe("http://localhost:4400");
    expect(args.consent).toBe("before");
    expect(args.pages).toHaveLength(7);
    expect(args.runs).toBe(3);
    expect(args.name).toBe("localhost-4400-before");
  });

  test("keep only the origin of the address and name the folder after it", () => {
    const args = parseLighthouseArgs([
      "--url",
      "https://forum.example.com/some/path?x=1",
      "--consent",
      "after",
      "--pages",
      "home, search",
    ]);
    expect(args.url).toBe("https://forum.example.com");
    expect(args.pages).toEqual(["home", "search"]);
    expect(args.name).toBe(folderName("https://forum.example.com", "after"));
    expect(args.name).toBe("forum.example.com-after");
    expect(parseLighthouseArgs(["--name", "large"]).name).toBe("large");
  });

  test("refuse what they cannot use", () => {
    expect(() => parseLighthouseArgs(["--consent", "maybe"])).toThrow("--consent");
    expect(() => parseLighthouseArgs(["--pages", "home,cart"])).toThrow('"cart"');
    expect(() => parseLighthouseArgs(["--runs", "0"])).toThrow("--runs");
    expect(() => parseLighthouseArgs(["--url", "ftp://x"])).toThrow("--url");
  });
});

describe("choosing pages", () => {
  test("the forum with the most threads, never a category", () => {
    const nodes = [
      { id: 1, type: "category", threadCount: 900 },
      { id: 2, type: "forum", threadCount: 5 },
      { id: 3, type: "forum", threadCount: 50 },
      { id: 4, type: "forum", threadCount: 0 },
    ];
    expect(pickForum(nodes)?.id).toBe(3);
    expect(pickForum([{ id: 1, type: "category", threadCount: 3 }])).toBeNull();
  });

  test("the thread with the most posts, and its page count", () => {
    const threads = [
      { id: 1, title: "a", lastPostPosition: 3 },
      { id: 2, title: "b", lastPostPosition: 45 },
    ];
    expect(pickThread(threads)?.id).toBe(2);
    expect(pickThread([])).toBeNull();
    expect(pageCount(0, 20)).toBe(1);
    expect(pageCount(19, 20)).toBe(1);
    expect(pageCount(20, 20)).toBe(2);
    expect(pageCount(45, 20)).toBe(3);
  });

  test("search words are whole words of five letters or more, longest first, once", () => {
    expect(searchWords(["The quick brown fox", "Quick onions"])).toEqual([
      "onions",
      "quick",
      "brown",
    ]);
    expect(searchWords(["a b c"])).toEqual([]);
  });

  test("a backend forum address is the app's own", () => {
    expect(ownPath("https://x.test/nodes/4-news")).toBe("/forums/4-news");
    expect(ownPath("https://x.test/threads/9-a?page=3")).toBe("/threads/9-a?page=3");
  });
});

describe("cookies", () => {
  test("the consent cookie reads back as a choice of the policy version in force", () => {
    const [name, value] = consentCookie(3, new Date("2026-01-02T03:04:05Z")).split("=");
    expect(name).toBe("forum_consent");
    const record = JSON.parse(decodeURIComponent(value!));
    expect(record.revision).toBe(3);
    expect(record.categories).toEqual(["necessary", "analytics", "referrals", "embeds"]);
    expect(record.lastConsentTimestamp).toBe("2026-01-02T03:04:05.000Z");
  });

  test("a Cookie header from Set-Cookie lines keeps the pairs and drops the attributes", () => {
    expect(
      cookieHeader([
        "better-auth.session_token=abc.def; Path=/; HttpOnly; SameSite=Lax",
        "better-auth.session_data=xyz; Max-Age=300",
        "gone=; Max-Age=0",
      ]),
    ).toBe("better-auth.session_token=abc.def; better-auth.session_data=xyz");
  });
});

describe("Chrome", () => {
  const present =
    (...paths: string[]) =>
    (path: string) =>
      paths.includes(path);

  test("CHROME_PATH first, then the installed browser, then Playwright's", () => {
    const installed = join("/pf", "Google", "Chrome", "Application", "chrome.exe");
    const env = { PROGRAMFILES: "/pf" };
    expect(findChrome({ ...env, CHROME_PATH: "/mine" }, present("/mine", installed))).toBe("/mine");
    expect(findChrome({ ...env, CHROME_PATH: "/gone" }, present(installed))).toBe(installed);
    expect(findChrome(env, present("/pw"), () => ["/pw"])).toBe("/pw");
    expect(findChrome({}, present(), () => ["/pw"])).toBeNull();
  });
});

describe("summary", () => {
  const report = (performance: number, llms: number | null): ReportFacts => ({
    requestedUrl: "http://localhost:4400/",
    finalUrl: "http://localhost:4400/",
    categories: { performance: { score: performance }, seo: { score: 1 } },
    audits: {
      "largest-contentful-paint": { score: 1, numericValue: performance * 1000 },
      "llms-txt":
        llms === null ? { score: null, scoreDisplayMode: "notApplicable" } : { score: llms },
    },
  });

  test("median of the runs, and the worst agentic audit", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
    const summary = summarise("http://localhost:4400/", [
      report(0.5, 1),
      report(0.9, 0),
      report(0.7, 1),
    ]);
    expect(summary.scores.performance).toBe(0.7);
    expect(summary.scores.accessibility).toBeNull();
    expect(summary.metrics["largest-contentful-paint"]).toBe(700);
    expect(summary.agentic["llms-txt"]).toBe(0);
    expect(summary.agentic["ard-schema"]).toBe("n/a");
    expect(summarise("u", [report(1, null)]).agentic["llms-txt"]).toBe("n/a");
  });

  test("one table line per address, with whole-number scores", () => {
    const table = formatSummary(
      [summarise("http://localhost:4400/threads/1", [report(0.934, 1)])],
      "http://localhost:4400",
    );
    const lines = table.split("\n");
    expect(lines[0]).toStartWith("page");
    expect(lines[1]).toContain("/threads/1");
    expect(lines[1]).toContain("93");
  });
});
