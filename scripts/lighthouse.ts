import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { postsList } from "@sermo/core/contracts";
import {
  type BrowserCookie,
  consentCookie,
  findChrome,
  formatSummary,
  isLoopback,
  type LighthouseArgs,
  type NodeFacts,
  outputFolder,
  ownPath,
  type PageName,
  pageCount,
  parseLighthouseArgs,
  parseSetCookies,
  pickForum,
  pickThread,
  playwrightChromiums,
  type ReportFacts,
  searchWords,
  summarise,
  type ThreadFacts,
} from "./lighthouse-lib";
import { defaultDatabase, readSignIn, seedEmail, stagingPaths } from "./staging-lib";

// Lighthouse CI on the main pages, in Lighthouse's mobile emulation, against a running site (by
// default the staging site on http://localhost:4400). See DECISIONS "Lighthouse (item 25)".
//
//   bun run lighthouse [--url <address>] [--consent before|after] [--pages home,forum,...]
//                      [--runs 3] [--dry-run] [--db <staging database>] [--name <folder>]
//
// The pages are found through the site's own API, so any data will do: the forum with the most
// threads; in it, of its 100 newest threads, the one with the most posts; a member with posts whose
// page search engines may index; a search word that has results; the member's first conversation.
// `--consent before` is a fresh visitor who sees the banner. `after` has accepted every category:
// the choice goes into the browser's cookie jar before the page loads (the banner is script that
// reads `document.cookie`), by `scripts/lighthouse-cookies.cjs`.
// The conversation page needs a signed-in member: E2E_USER and E2E_PASSWORD (an email address or a
// username), or, only for an address on this machine, the staging administrator of the seed named
// by --db (the login `staging:status` prints). With neither, the page is left out with a note.
// Reports and a `summary.json` go to `.lighthouseci/<host>-<consent>/` (or `--name`), which every
// run empties first, with the screenshot of each address in `screenshots/`. A whole page list takes
// about five minutes, so to split it run `--pages` subsets under different `--name`s.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configFile = join(root, "lighthouserc.cjs");
// The posts of a thread page: the contract's default, as the web app's page uses.
const PAGE_SIZE = postsList.input.parse({ threadId: 1 }).limit;

class SiteError extends Error {}

async function api<T>(base: string, path: string, cookie = ""): Promise<T> {
  const response = await fetch(`${base}/api/v1${path}`, {
    headers: cookie ? { cookie } : {},
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new SiteError(`GET ${path} answered ${response.status}.`);
  return (await response.json()) as T;
}

/** What the run needs of the site besides its pages. */
interface Found {
  addresses: Map<string, string>;
  version: number;
  /** Optional consent categories the banner does not offer. */
  omit: string[];
  language: string;
}

async function canonicalOf(base: string, path: string): Promise<string> {
  const { canonical } = await api<{ canonical: string }>(base, path);
  return base + ownPath(canonical);
}

async function discover(base: string, args: LighthouseArgs): Promise<Found> {
  const addresses = new Map<string, string>();
  const site = await api<{
    cookiePolicyVersion?: number;
    defaultLanguage?: string;
    analytics?: { provider?: string };
    matomoCookieless?: boolean;
  }>(base, "/site");
  const wants = (...names: PageName[]) => names.some((name) => args.pages.includes(name));
  if (wants("home")) addresses.set("home", `${base}/`);

  const needsThread = wants("forum", "thread-first", "thread-last", "search");
  if (needsThread) {
    const { items } = await api<{ items: NodeFacts[] }>(base, "/nodes");
    const forum = pickForum(items);
    if (!forum) throw new SiteError("The site has no forum with threads.");
    if (wants("forum")) addresses.set("forum", await canonicalOf(base, `/seo/nodes/${forum.id}`));

    const list = await api<{
      items: { id: number; title: string; lastPost: { position: number } }[];
      sticky: { id: number; title: string; lastPost: { position: number } }[];
    }>(base, `/nodes/${forum.id}/threads?limit=100`);
    const threads: ThreadFacts[] = [...list.sticky, ...list.items].map((thread) => ({
      id: thread.id,
      title: thread.title,
      lastPostPosition: thread.lastPost.position,
    }));
    const thread = pickThread(threads);
    if (!thread) throw new SiteError(`Forum ${forum.id} lists no thread.`);
    const pages = pageCount(thread.lastPostPosition, PAGE_SIZE);
    if (pages < 2)
      console.warn(`Thread ${thread.id} has one page: the last page is the first page.`);
    if (wants("thread-first"))
      addresses.set("thread-first", await canonicalOf(base, `/seo/threads/${thread.id}`));
    if (wants("thread-last"))
      addresses.set(
        "thread-last",
        await canonicalOf(base, `/seo/threads/${thread.id}?page=${pages}&pageSize=${PAGE_SIZE}`),
      );
    if (wants("search")) {
      for (const word of searchWords(threads.map((t) => t.title))) {
        const { items: hits } = await api<{ items: unknown[] }>(
          base,
          `/search?q=${encodeURIComponent(word)}&limit=1`,
        );
        if (hits.length > 0) {
          addresses.set("search", `${base}/search?q=${encodeURIComponent(word)}`);
          break;
        }
      }
      if (!addresses.has("search")) throw new SiteError("No search term has results.");
    }
  }

  if (wants("profile")) {
    // A member with posts, whose page the backend lets search engines index (an empty profile is
    // `noindex`, which would fail the SEO score for a reason that is not the page's).
    const { items } = await api<{ items: { card: { id: number }; postCount: number }[] }>(
      base,
      "/members?sort=level&limit=100",
    );
    const members = [...items].sort((a, b) => b.postCount - a.postCount).slice(0, 10);
    if (members.length === 0) throw new SiteError("The member list is empty.");
    let chosen = members[0]!.card.id;
    let indexable = false;
    for (const member of members) {
      const { robots } = await api<{ robots: string }>(base, `/seo/users/${member.card.id}`);
      if (robots.startsWith("index")) {
        chosen = member.card.id;
        indexable = true;
        break;
      }
    }
    if (!indexable)
      console.warn(`No member page is indexable: using member ${chosen}, whose SEO will show it.`);
    addresses.set("profile", await canonicalOf(base, `/seo/users/${chosen}`));
  }
  const cookieless = site.matomoCookieless === true && site.analytics?.provider === "matomo";
  return {
    addresses,
    version: site.cookiePolicyVersion ?? 1,
    omit: cookieless ? ["analytics"] : [],
    language: site.defaultLanguage ?? "en",
  };
}

/** The login for the conversation page, or null (with the reason printed) when there is none. */
function credentials(args: LighthouseArgs): { login: string; password: string } | null {
  const { E2E_USER: login, E2E_PASSWORD: password } = process.env;
  if (login && password) return { login, password };
  if (login || password) {
    console.log("E2E_USER and E2E_PASSWORD must both be set.");
    return null;
  }
  if (isLoopback(args.url)) {
    const known = readSignIn(stagingPaths(resolve(args.db ?? defaultDatabase())));
    if (known) return { login: seedEmail(known.adminId), password: known.password };
    console.log("No staging seed meta next to --db: the sign-in is unknown.");
    return null;
  }
  console.log("No E2E_USER and E2E_PASSWORD for this address.");
  return null;
}

/** Signs in and returns the session cookies. */
async function signIn(base: string, login: string, password: string): Promise<BrowserCookie[]> {
  const byEmail = login.includes("@");
  const response = await fetch(`${base}/api/auth/sign-in/${byEmail ? "email" : "username"}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify(byEmail ? { email: login, password } : { username: login, password }),
    signal: AbortSignal.timeout(30_000),
  });
  const cookies = parseSetCookies(response.headers.getSetCookie());
  if (!response.ok || cookies.length === 0)
    throw new SiteError(`The sign-in answered ${response.status}.`);
  return cookies;
}

const cookieHeader = (cookies: BrowserCookie[]) =>
  cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");

function playwrightChromes(): string[] {
  const base = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "ms-playwright")
    : join(process.env.HOME ?? "", ".cache", "ms-playwright");
  return existsSync(base) ? playwrightChromiums(base, readdirSync(base)) : [];
}

function lhci(
  command: string,
  work: string,
  runFile: string,
  { cookies, https, host }: { cookies?: BrowserCookie[]; https?: boolean; host?: string } = {},
  extra: string[] = [],
): number {
  const require = createRequire(import.meta.url);
  const cli = join(dirname(require.resolve("@lhci/cli/package.json")), "src", "cli.js");
  const node = Bun.which("node");
  if (!node) throw new Error("Node 22.19 or later is needed to run Lighthouse; none is on PATH.");
  const env: Record<string, string | undefined> = {
    ...process.env,
    LIGHTHOUSE_RUN_FILE: runFile,
    LIGHTHOUSE_COOKIES: cookies?.length ? JSON.stringify({ host, https, cookies }) : undefined,
  };
  const result = spawnSync(node, [cli, command, `--config=${configFile}`, ...extra], {
    cwd: work,
    env,
    stdio: "inherit",
  });
  return result.status ?? 1;
}

function readReports(folder: string): ReportFacts[] {
  return readdirSync(folder)
    .filter((file) => file.endsWith(".report.json"))
    .map((file) => JSON.parse(readFileSync(join(folder, file), "utf8")) as ReportFacts);
}

/** The last screenshot of one run of each address, to see whether the banner was drawn. */
function saveScreenshots(reports: ReportFacts[], folder: string): void {
  mkdirSync(folder, { recursive: true });
  const seen = new Set<string>();
  for (const report of reports) {
    const data = report.audits["final-screenshot"]?.details?.data;
    if (seen.has(report.requestedUrl) || !data?.startsWith("data:image/jpeg;base64,")) continue;
    seen.add(report.requestedUrl);
    const name = new URL(report.requestedUrl).pathname.replace(/[^a-z0-9]+/gi, "-");
    writeFileSync(
      join(folder, `${String(seen.size).padStart(2, "0")}${name}.jpg`),
      Buffer.from(data.slice("data:image/jpeg;base64,".length), "base64"),
    );
  }
}

async function main(): Promise<number> {
  const args = parseLighthouseArgs(process.argv.slice(2));
  const work = outputFolder(root, args.name);
  const chromePath = findChrome(process.env, existsSync, playwrightChromes);
  if (!chromePath) throw new Error("No Chrome found: set CHROME_PATH.");

  const found = await discover(args.url, args);
  const https = args.url.startsWith("https:");
  const host = new URL(args.url).hostname;
  const consent: BrowserCookie[] =
    args.consent === "after"
      ? [
          consentCookie(found.version, {
            omit: found.omit,
            language: found.language,
            https,
          }),
        ]
      : [];
  const guestUrls = args.pages
    .filter((page) => page !== "conversation")
    .map((page) => found.addresses.get(page))
    .filter((address): address is string => address !== undefined);
  const groups: { urls: string[]; cookies: BrowserCookie[] }[] = [];
  if (guestUrls.length > 0) groups.push({ urls: guestUrls, cookies: consent });
  if (args.pages.includes("conversation")) {
    try {
      const login = credentials(args);
      if (!login) throw new SiteError("no login");
      const session = await signIn(args.url, login.login, login.password);
      const { items } = await api<{ items: { id: number }[] }>(
        args.url,
        "/conversations?limit=1",
        cookieHeader(session),
      );
      if (items.length === 0) throw new SiteError("the member has no conversation");
      groups.push({
        urls: [`${args.url}/conversations/${items[0]!.id}`],
        cookies: [...session, ...consent],
      });
    } catch (error) {
      const why = error instanceof SiteError ? error.message : String(error);
      console.log(`The conversation page is left out: ${why}.`);
    }
  }

  const addresses = groups.flatMap((group) => group.urls);
  if (addresses.length === 0) throw new SiteError("There is no page to run.");
  console.log(`Lighthouse on ${args.url}, consent ${args.consent}, ${args.runs} runs of:`);
  for (const address of addresses) console.log(`  ${address}`);
  if (args.dryRun) return 0;

  const reports = join(work, "reports");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(reports, { recursive: true });
  const runFile = join(work, "run.json");

  let additive = false;
  for (const group of groups) {
    writeFileSync(
      runFile,
      JSON.stringify({ urls: group.urls, runs: args.runs, chromePath, outputDir: reports }),
    );
    const status = lhci(
      "collect",
      work,
      runFile,
      { cookies: group.cookies, https, host },
      additive ? ["--additive"] : [],
    );
    if (status !== 0) return status;
    additive = true;
  }
  const asserted = lhci("assert", work, runFile);
  const uploaded = lhci("upload", work, runFile);

  const all = readReports(reports);
  saveScreenshots(all, join(work, "screenshots"));
  const summaries = [...new Set(all.map((report) => report.requestedUrl))].map((url) =>
    summarise(
      url,
      all.filter((report) => report.requestedUrl === url),
    ),
  );
  for (const summary of summaries)
    if (summary.finalUrl !== summary.url)
      console.warn(`${summary.url} ended at ${summary.finalUrl}: a redirect costs time.`);
  console.log(`\nMedian of ${args.runs} runs, ${args.url}, consent ${args.consent}:`);
  console.log(formatSummary(summaries, args.url));
  console.log(`Reports and screenshots: ${work}`);
  writeFileSync(join(reports, "summary.json"), `${JSON.stringify(summaries, null, 2)}\n`);
  return asserted !== 0 || uploaded !== 0 ? 1 : 0;
}

let exitCode = 0;
try {
  exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exitCode = 1;
}
process.exit(exitCode);
