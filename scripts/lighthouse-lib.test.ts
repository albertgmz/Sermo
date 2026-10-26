import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  consentCookie,
  findChrome,
  folderName,
  formatSummary,
  isLoopback,
  median,
  outputFolder,
  ownPath,
  pageCount,
  parseLighthouseArgs,
  parseSetCookies,
  pickForum,
  pickThread,
  playwrightChromiums,
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
    expect(args.name).toBe("forum-example-com-after");
    expect(parseLighthouseArgs(["--name", "large"]).name).toBe("large");
  });

  test("refuse what they cannot use", () => {
    expect(() => parseLighthouseArgs(["--consent", "maybe"])).toThrow("--consent");
    expect(() => parseLighthouseArgs(["--pages", "home,cart"])).toThrow('"cart"');
    expect(() => parseLighthouseArgs(["--runs", "0"])).toThrow("--runs");
    expect(() => parseLighthouseArgs(["--url", "ftp://x"])).toThrow("--url");
  });

  test("a folder name is letters, digits and hyphens, and stays inside .lighthouseci", () => {
    const root = resolve("/repo");
    expect(outputFolder(root, "large-before")).toBe(join(root, ".lighthouseci", "large-before"));
    for (const name of ["..", ".", "../apps", "a/b", "a\\b", "", "Big", "a b", "x..y"])
      expect(() => outputFolder(root, name)).toThrow("--name");
  });

  test("a loopback address is the only one the staging login may go to", () => {
    expect(isLoopback("http://localhost:4400")).toBe(true);
    expect(isLoopback("http://127.0.0.1:4400")).toBe(true);
    expect(isLoopback("https://forum.albertgmz.com")).toBe(false);
    expect(isLoopback("http://localhost.example.com")).toBe(false);
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
  const stamp = new Date("2026-01-02T03:04:05Z");
  const read = (cookie: { value: string }) => JSON.parse(decodeURIComponent(cookie.value));

  test("the consent cookie is the banner's Accept all: every optional category, the policy version", () => {
    const cookie = consentCookie(3, { now: stamp });
    expect(cookie.name).toBe("forum_consent");
    expect(cookie.httpOnly).toBe(false);
    const record = read(cookie);
    expect(record.revision).toBe(3);
    expect(record.categories).toEqual(["necessary", "analytics", "referrals", "embeds"]);
    expect(Object.keys(record.services)).toEqual(record.categories);
    expect(record.languageCode).toBe("en");
    expect(record.lastConsentTimestamp).toBe("2026-01-02T03:04:05.000Z");
    expect(record.expirationTime).toBe(stamp.getTime() + 182 * 86_400_000);
  });

  test("the page language goes in", () => {
    const record = read(consentCookie(1, { language: "es", https: true }));
    expect(record.languageCode).toBe("es");
    expect(consentCookie(1, { https: true }).secure).toBe(true);
  });

  test("cookies of Set-Cookie lines keep their name, value and flags, and a cleared one goes", () => {
    expect(
      parseSetCookies([
        "sermo.session_token=abc.def; Path=/; HttpOnly; SameSite=Lax",
        "sermo.session_data=xyz=; Max-Age=300; Secure",
        "gone=; Max-Age=0",
      ]),
    ).toEqual([
      {
        name: "sermo.session_token",
        value: "abc.def",
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      },
      { name: "sermo.session_data", value: "xyz=", httpOnly: false, secure: true },
    ]);
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

describe("Playwright's Chromium", () => {
  test("the newest version first, compared as a number", () => {
    const found = playwrightChromiums("/pw", [
      "chromium-999",
      "ffmpeg-1011",
      "chromium-1248",
      "chromium_headless_shell-1248",
    ]);
    expect(found[0]).toBe(join("/pw", "chromium-1248", "chrome-win64", "chrome.exe"));
    expect(found.at(-1)).toBe(join("/pw", "chromium-999", "chrome-win", "chrome.exe"));
    expect(found).toHaveLength(4);
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

describe("the SEO hold for pages that stay out of search engines", () => {
  // lighthouserc.cjs reads the run file named in the environment when it is loaded.
  const folder = mkdtempSync(join(tmpdir(), "sermo-lhrc-"));
  writeFileSync(join(folder, "run.json"), JSON.stringify({ urls: [], runs: 1, outputDir: folder }));
  process.env.LIGHTHOUSE_RUN_FILE = join(folder, "run.json");
  const config = createRequire(import.meta.url)("../lighthouserc.cjs");
  rmSync(folder, { recursive: true, force: true });
  const [indexable, held] = config.ci.assert.assertMatrix.map(
    (entry: { matchingUrlPattern: string }) => new RegExp(entry.matchingUrlPattern),
  );

  test("matches search and conversations, with a query or an id, and nothing that only starts like them", () => {
    for (const url of [
      "http://localhost:4400/search?q=word",
      "https://forum.example.com/search",
      "http://localhost:4400/conversations/43",
      "http://localhost:4400/conversations",
    ]) {
      expect(held.test(url)).toBe(true);
      expect(indexable.test(url)).toBe(false);
    }
    for (const url of [
      "http://localhost:4400/",
      "http://localhost:4400/searchable",
      "http://localhost:4400/search-tips",
      "http://localhost:4400/conversations-archive",
      "http://search.example.com/",
      "http://localhost:4400/threads/1-a?x=/search",
    ]) {
      expect(held.test(url)).toBe(false);
      expect(indexable.test(url)).toBe(true);
    }
  });
});
