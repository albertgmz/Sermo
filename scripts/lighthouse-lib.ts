import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

// The parts of the Lighthouse runner that need no process, browser or network: arguments, the
// choice of pages from what the site's API returns, the consent cookie, the Chrome to use and the
// summary of the reports. scripts/lighthouse.ts does the rest.

export const PAGES = [
  "home",
  "forum",
  "thread-first",
  "thread-last",
  "profile",
  "conversation",
  "search",
] as const;
export type PageName = (typeof PAGES)[number];

export const CONSENT_MODES = ["before", "after"] as const;
export type ConsentMode = (typeof CONSENT_MODES)[number];

export const STAGING_URL = "http://localhost:4400";
export const DEFAULT_RUNS = 3;

export interface LighthouseArgs {
  url: string;
  consent: ConsentMode;
  pages: PageName[];
  runs: number;
  additive: boolean;
  dryRun: boolean;
  db: string | undefined;
  name: string;
}

/** `http://localhost:4400/` and `https://forum.example.com` become folder names. */
export function folderName(url: string, consent: ConsentMode): string {
  const { host } = new URL(url);
  return `${host.replace(/[^a-z0-9.-]/gi, "-")}-${consent}`;
}

export function parseLighthouseArgs(argv: string[]): LighthouseArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      url: { type: "string" },
      consent: { type: "string" },
      pages: { type: "string" },
      runs: { type: "string" },
      additive: { type: "boolean" },
      "dry-run": { type: "boolean" },
      db: { type: "string" },
      name: { type: "string" },
    },
  });
  const url = new URL(values.url ?? STAGING_URL);
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("--url must be an http or https address.");
  const base = url.origin;
  const consent = values.consent ?? "before";
  if (!CONSENT_MODES.includes(consent as ConsentMode))
    throw new Error(`--consent must be one of ${CONSENT_MODES.join(", ")}.`);
  const pages = values.pages ? values.pages.split(",").map((page) => page.trim()) : [...PAGES];
  for (const page of pages)
    if (!PAGES.includes(page as PageName))
      throw new Error(`Unknown page "${page}". Pages: ${PAGES.join(", ")}.`);
  const runs = Number(values.runs ?? DEFAULT_RUNS);
  if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be a whole number.");
  return {
    url: base,
    consent: consent as ConsentMode,
    pages: pages as PageName[],
    runs,
    additive: values.additive ?? false,
    dryRun: values["dry-run"] ?? false,
    db: values.db,
    name: values.name ?? folderName(base, consent as ConsentMode),
  };
}

// What the site's API returns, cut to the fields the choice reads.
export interface NodeFacts {
  id: number;
  type: string;
  threadCount: number;
}
export interface ThreadFacts {
  id: number;
  title: string;
  lastPostPosition: number;
}

/** The forum (not a category) with the most threads. */
export function pickForum(nodes: NodeFacts[]): NodeFacts | null {
  return (
    nodes
      .filter((node) => node.type === "forum" && node.threadCount > 0)
      .sort((a, b) => b.threadCount - a.threadCount)[0] ?? null
  );
}

/** The thread with the most posts, which has the most pages. */
export function pickThread(threads: ThreadFacts[]): ThreadFacts | null {
  return [...threads].sort((a, b) => b.lastPostPosition - a.lastPostPosition)[0] ?? null;
}

/** Pages a visitor sees: positions start at 0 and a page holds `pageSize` posts. */
export function pageCount(lastPostPosition: number, pageSize: number): number {
  return Math.floor(lastPostPosition / pageSize) + 1;
}

/** Words of a title worth searching for: whole words of five letters or more, longest first. */
export function searchWords(titles: string[]): string[] {
  const seen = new Set<string>();
  for (const title of titles)
    for (const word of title.match(/\p{L}{5,}/gu) ?? []) seen.add(word.toLowerCase());
  return [...seen].sort((a, b) => b.length - a.length);
}

/**
 * A backend address as the web app serves it: the backend calls forums `nodes`, this app
 * `forums` (addresses.ts). The address of a page keeps its query.
 */
export function ownPath(canonical: string): string {
  const { pathname, search } = new URL(canonical);
  return pathname.replace(/^\/nodes\//, "/forums/") + search;
}

/**
 * The cookie the banner writes on "Accept all" (the library's own shape, as lib/consent/account.ts
 * writes it for a choice made elsewhere), so a visit "after" is a returning visitor who accepted.
 */
export function consentCookie(version: number, now: Date = new Date()): string {
  const stamp = now.toISOString();
  const value = JSON.stringify({
    categories: ["necessary", "analytics", "referrals", "embeds"],
    revision: version,
    data: null,
    consentTimestamp: stamp,
    consentId: "lighthouse",
    services: { necessary: [], analytics: [], referrals: [], embeds: [] },
    languageCode: "en",
    lastConsentTimestamp: stamp,
  });
  return `forum_consent=${encodeURIComponent(value)}`;
}

/** `name=value` pairs of the `Set-Cookie` headers of a response, as one `Cookie` header. */
export function cookieHeader(setCookies: string[]): string {
  return setCookies
    .map((line) => line.split(";")[0]?.trim() ?? "")
    .filter((pair) => pair.includes("=") && !pair.endsWith("="))
    .join("; ");
}

/** Chrome for the runs: `CHROME_PATH`, the installed browser, then Playwright's Chromium. */
export function findChrome(
  env: Record<string, string | undefined>,
  exists: (path: string) => boolean = existsSync,
  listPlaywright: () => string[] = () => [],
): string | null {
  if (env.CHROME_PATH && exists(env.CHROME_PATH)) return env.CHROME_PATH;
  const roots = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(
    (root): root is string => Boolean(root),
  );
  const installed = roots
    .map((root) => join(root, "Google", "Chrome", "Application", "chrome.exe"))
    .concat(["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"])
    .find((path) => exists(path));
  if (installed) return installed;
  return listPlaywright().find((path) => exists(path)) ?? null;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export const CATEGORY_IDS = [
  "performance",
  "accessibility",
  "best-practices",
  "seo",
  "agentic-browsing",
] as const;
export const AGENTIC_AUDITS = [
  "agent-accessibility-tree",
  "llms-txt",
  "ard-schema",
  "webmcp-registered-tools",
  "webmcp-form-coverage",
  "webmcp-schema-validity",
] as const;
export const METRICS = [
  "first-contentful-paint",
  "largest-contentful-paint",
  "total-blocking-time",
  "cumulative-layout-shift",
  "speed-index",
] as const;

// The part of a Lighthouse report the summary reads.
export interface ReportFacts {
  requestedUrl: string;
  finalUrl: string;
  categories: Record<string, { score: number | null } | undefined>;
  audits: Record<
    string,
    { score: number | null; scoreDisplayMode?: string; numericValue?: number } | undefined
  >;
}

export interface UrlSummary {
  url: string;
  finalUrl: string;
  runs: number;
  /** Median score of each category, 0 to 1. */
  scores: Record<string, number | null>;
  /** Median numeric value of each metric (milliseconds; layout shift has no unit). */
  metrics: Record<string, number | null>;
  /** Lowest score of each agentic audit over the runs, or "n/a" when it did not apply. */
  agentic: Record<string, number | "n/a">;
}

export function summarise(url: string, reports: ReportFacts[]): UrlSummary {
  const scores: UrlSummary["scores"] = {};
  for (const id of CATEGORY_IDS)
    scores[id] = median(
      reports.flatMap((report) => {
        const score = report.categories[id]?.score;
        return typeof score === "number" ? [score] : [];
      }),
    );
  const metrics: UrlSummary["metrics"] = {};
  for (const id of METRICS)
    metrics[id] = median(
      reports.flatMap((report) => {
        const value = report.audits[id]?.numericValue;
        return typeof value === "number" ? [value] : [];
      }),
    );
  const agentic: UrlSummary["agentic"] = {};
  for (const id of AGENTIC_AUDITS) {
    const found = reports.flatMap((report) => {
      const audit = report.audits[id];
      return audit && audit.scoreDisplayMode !== "notApplicable" && typeof audit.score === "number"
        ? [audit.score]
        : [];
    });
    agentic[id] = found.length > 0 ? Math.min(...found) : "n/a";
  }
  return {
    url,
    finalUrl: reports[0]?.finalUrl ?? url,
    runs: reports.length,
    scores,
    metrics,
    agentic,
  };
}

const whole = (score: number | null | undefined) =>
  typeof score === "number" ? String(Math.round(score * 100)) : "-";

/** One line per address: the four scores, the agentic score and the metrics that explain them. */
export function formatSummary(summaries: UrlSummary[], base: string): string {
  const header = ["page", "perf", "a11y", "best", "seo", "agent", "FCP", "LCP", "TBT", "CLS"];
  const rows = summaries.map((summary) => {
    const path = summary.url.startsWith(base) ? summary.url.slice(base.length) || "/" : summary.url;
    const ms = (id: string) => {
      const value = summary.metrics[id];
      return typeof value === "number" ? String(Math.round(value)) : "-";
    };
    const cls = summary.metrics["cumulative-layout-shift"];
    return [
      path,
      whole(summary.scores.performance),
      whole(summary.scores.accessibility),
      whole(summary.scores["best-practices"]),
      whole(summary.scores.seo),
      whole(summary.scores["agentic-browsing"]),
      ms("first-contentful-paint"),
      ms("largest-contentful-paint"),
      ms("total-blocking-time"),
      typeof cls === "number" ? cls.toFixed(3) : "-",
    ];
  });
  const widths = header.map((title, at) =>
    Math.max(title.length, ...rows.map((row) => row[at]!.length)),
  );
  const line = (cells: string[]) => cells.map((cell, at) => cell.padEnd(widths[at]!)).join("  ");
  return [line(header), ...rows.map(line)].join("\n");
}
