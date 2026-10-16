import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
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
  dryRun: boolean;
  db: string | undefined;
  name: string;
}

/** `http://localhost:4400/` and `https://forum.example.com` become `localhost-4400-before` and so on. */
export function folderName(url: string, consent: ConsentMode): string {
  const { host } = new URL(url);
  return `${host.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${consent}`;
}

const NAME = /^[a-z0-9-]+$/;

/** The folder of a run, inside `<root>/.lighthouseci` and nowhere else (it is emptied first). */
export function outputFolder(root: string, name: string): string {
  const base = resolve(root, ".lighthouseci");
  const folder = resolve(base, name);
  if (!NAME.test(name) || !folder.startsWith(base + sep))
    throw new Error("--name takes letters a-z, digits and hyphens only.");
  return folder;
}

/** Whether the address is on this machine, where the staging administrator's login may be used. */
export function isLoopback(url: string): boolean {
  const { hostname } = new URL(url);
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function parseLighthouseArgs(argv: string[]): LighthouseArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      url: { type: "string" },
      consent: { type: "string" },
      pages: { type: "string" },
      runs: { type: "string" },
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

/** A cookie as it goes into the browser's own cookie jar. */
export interface BrowserCookie {
  name: string;
  value: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

/** How long the banner library keeps its cookie (lib/consent/account.ts: CONSENT_COOKIE_DAYS). */
const CONSENT_DAYS = 182;

/**
 * The cookie the banner writes on "Accept all", field for field as the library writes it (see the
 * cookie of a real click, and lib/consent/account.ts for the same shape written from an account):
 * every optional category the banner offers, `revision` the policy version, `services` an empty list
 * per category, the language of the page. The banner leaves out `analytics` when the site's only
 * analytics is Matomo without cookies (`omit`). The value is URL-encoded JSON, as the library
 * writes it; it is not HTTP-only (the library reads it in the page) and lasts as long as the
 * library's own.
 */
export function consentCookie(
  version: number,
  options: { omit?: readonly string[]; language?: string; https?: boolean; now?: Date } = {},
): BrowserCookie {
  const { omit = [], language = "en", https = false, now = new Date() } = options;
  const optional = ["analytics", "referrals", "embeds"].filter((name) => !omit.includes(name));
  const categories = ["necessary", ...optional];
  const stamp = now.toISOString();
  const value = JSON.stringify({
    categories,
    revision: version,
    data: null,
    consentTimestamp: stamp,
    consentId: crypto.randomUUID(),
    services: Object.fromEntries(categories.map((name) => [name, []])),
    languageCode: language,
    lastConsentTimestamp: stamp,
    expirationTime: now.getTime() + CONSENT_DAYS * 86_400_000,
  });
  return {
    name: "forum_consent",
    value: encodeURIComponent(value),
    httpOnly: false,
    secure: https,
    sameSite: "Lax",
  };
}

/** The cookies a response sets, from its `Set-Cookie` lines (a cleared cookie is left out). */
export function parseSetCookies(setCookies: string[]): BrowserCookie[] {
  return setCookies.flatMap((line) => {
    const [pair = "", ...attributes] = line.split(";").map((part) => part.trim());
    const at = pair.indexOf("=");
    if (at < 1 || at === pair.length - 1) return [];
    const flags = attributes.map((attribute) => attribute.toLowerCase());
    const sameSite = flags.find((flag) => flag.startsWith("samesite="))?.slice("samesite=".length);
    return [
      {
        name: pair.slice(0, at),
        value: pair.slice(at + 1),
        httpOnly: flags.includes("httponly"),
        secure: flags.includes("secure"),
        ...(sameSite === "strict" || sameSite === "lax" || sameSite === "none"
          ? {
              sameSite: (sameSite[0]!.toUpperCase() + sameSite.slice(1)) as
                | "Strict"
                | "Lax"
                | "None",
            }
          : {}),
      },
    ];
  });
}

/** Chromium folders of Playwright's browser cache, newest version first (numerically). */
export function playwrightChromiums(base: string, folders: string[]): string[] {
  return folders
    .flatMap((folder) => {
      const version = /^chromium-(\d+)$/.exec(folder)?.[1];
      return version ? [{ folder, version: Number(version) }] : [];
    })
    .sort((a, b) => b.version - a.version)
    .flatMap(({ folder }) => [
      join(base, folder, "chrome-win64", "chrome.exe"),
      join(base, folder, "chrome-win", "chrome.exe"),
    ]);
}

/** Chrome for the runs: `CHROME_PATH`, the installed browser, then Playwright's Chromium. */
export function findChrome(
  env: Record<string, string | undefined>,
  exists: (path: string) => boolean = existsSync,
  listPlaywright: () => string[] = () => [],
): string | null {
  if (env.CHROME_PATH && exists(env.CHROME_PATH)) return env.CHROME_PATH;
  const installed = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA]
    .filter((root): root is string => Boolean(root))
    .map((root) => join(root, "Google", "Chrome", "Application", "chrome.exe"))
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
    | {
        score: number | null;
        scoreDisplayMode?: string;
        numericValue?: number;
        details?: { data?: string };
      }
    | undefined
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
