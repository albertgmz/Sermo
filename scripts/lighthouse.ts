import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  consentCookie,
  cookieHeader,
  findChrome,
  formatSummary,
  type LighthouseArgs,
  type NodeFacts,
  ownPath,
  type PageName,
  pageCount,
  parseLighthouseArgs,
  pickForum,
  pickThread,
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
//                      [--runs 3] [--additive] [--dry-run] [--db <staging database>]
//                      [--name <folder>]
//
// The pages are found through the site's own API, so any data will do. The conversation page
// signs in with E2E_USER and E2E_PASSWORD (an email address or a username), or else as the
// staging administrator (the database named by --db, as `staging:status` prints). `--consent
// before` is a fresh visitor who sees the banner; `after` has accepted every category. Reports go
// to `.lighthouseci/<host>-<consent>/` (or `--name`), ignored by git. `--dry-run` only lists the
// addresses. Each address is run three times; a whole page list takes about five minutes, so
// `--pages` and `--additive` split it.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configFile = join(root, "lighthouserc.cjs");
const PAGE_SIZE = 20;

class SiteError extends Error {}

async function api<T>(base: string, path: string, cookie = ""): Promise<T> {
  const response = await fetch(`${base}/api/v1${path}`, {
    headers: cookie ? { cookie } : {},
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new SiteError(`GET ${path} answered ${response.status}.`);
  return (await response.json()) as T;
}

/** The pages that need no sign-in, by name. */
interface Found {
  addresses: Map<string, string>;
  version: number;
}

async function canonicalOf(base: string, path: string): Promise<string> {
  const { canonical } = await api<{ canonical: string }>(base, path);
  return base + ownPath(canonical);
}

async function discover(base: string, args: LighthouseArgs): Promise<Found> {
  const addresses = new Map<string, string>();
  const { cookiePolicyVersion } = await api<{ cookiePolicyVersion?: number }>(base, "/site");
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
    for (const member of members) {
      const { robots } = await api<{ robots: string }>(base, `/seo/users/${member.card.id}`);
      if (robots.startsWith("index")) {
        chosen = member.card.id;
        break;
      }
    }
    addresses.set("profile", await canonicalOf(base, `/seo/users/${chosen}`));
  }
  return { addresses, version: cookiePolicyVersion ?? 1 };
}

/** Signs in and returns the session cookies, and the address of the member's first conversation. */
async function signIn(base: string, args: LighthouseArgs): Promise<string> {
  let login = process.env.E2E_USER;
  let password = process.env.E2E_PASSWORD;
  if (!login || !password) {
    const known = readSignIn(stagingPaths(resolve(args.db ?? defaultDatabase())));
    if (!known)
      throw new SiteError("No sign-in: set E2E_USER and E2E_PASSWORD, or name --db of the seed.");
    login = seedEmail(known.adminId);
    password = known.password;
  }
  const byEmail = login.includes("@");
  const response = await fetch(`${base}/api/auth/sign-in/${byEmail ? "email" : "username"}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify(byEmail ? { email: login, password } : { username: login, password }),
    signal: AbortSignal.timeout(30_000),
  });
  const cookie = cookieHeader(response.headers.getSetCookie());
  if (!response.ok || !cookie)
    throw new SiteError(`Sign-in as ${login} answered ${response.status}.`);
  return cookie;
}

function playwrightChromes(): string[] {
  const base = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "ms-playwright")
    : join(process.env.HOME ?? "", ".cache", "ms-playwright");
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((folder) => /^chromium-\d+$/.test(folder))
    .sort()
    .reverse()
    .flatMap((folder) => [
      join(base, folder, "chrome-win64", "chrome.exe"),
      join(base, folder, "chrome-win", "chrome.exe"),
      join(base, folder, "chrome-linux64", "chrome"),
      join(base, folder, "chrome-linux", "chrome"),
    ]);
}

function lhci(command: string, work: string, runFile: string, extra: string[] = []): number {
  const require = createRequire(import.meta.url);
  const cli = join(dirname(require.resolve("@lhci/cli/package.json")), "src", "cli.js");
  const node = Bun.which("node");
  if (!node) throw new Error("Node is needed to run Lighthouse; it is not on PATH.");
  const result = spawnSync(node, [cli, command, `--config=${configFile}`, ...extra], {
    cwd: work,
    env: { ...process.env, LIGHTHOUSE_RUN_FILE: runFile },
    stdio: "inherit",
  });
  return result.status ?? 1;
}

function readReports(folder: string): ReportFacts[] {
  return readdirSync(folder)
    .filter((file) => file.endsWith(".report.json"))
    .map((file) => JSON.parse(readFileSync(join(folder, file), "utf8")) as ReportFacts);
}

async function main(): Promise<number> {
  const args = parseLighthouseArgs(process.argv.slice(2));
  const chromePath = findChrome(process.env, existsSync, playwrightChromes);
  if (!chromePath) throw new Error("No Chrome found: set CHROME_PATH.");

  const found = await discover(args.url, args);
  const consent = args.consent === "after" ? consentCookie(found.version) : "";
  const guestUrls = args.pages
    .filter((page) => page !== "conversation")
    .map((page) => found.addresses.get(page))
    .filter((address): address is string => address !== undefined);
  const groups: { urls: string[]; cookie: string }[] = [];
  if (guestUrls.length > 0) groups.push({ urls: guestUrls, cookie: consent });
  if (args.pages.includes("conversation")) {
    const session = await signIn(args.url, args);
    const { items } = await api<{ items: { id: number }[] }>(
      args.url,
      "/conversations?limit=1",
      session,
    );
    if (items.length === 0) throw new SiteError("The signed-in member has no conversation.");
    groups.push({
      urls: [`${args.url}/conversations/${items[0]!.id}`],
      cookie: [session, consent].filter(Boolean).join("; "),
    });
  }

  if (args.dryRun) {
    for (const group of groups) for (const address of group.urls) console.log(address);
    return 0;
  }

  const work = join(root, ".lighthouseci", args.name);
  const reports = join(work, "reports");
  if (!args.additive) rmSync(work, { recursive: true, force: true });
  mkdirSync(reports, { recursive: true });
  const runFile = join(work, "run.json");

  const addresses = groups.flatMap((group) => group.urls);
  console.log(`Lighthouse on ${args.url}, consent ${args.consent}, ${args.runs} runs of:`);
  for (const address of addresses) console.log(`  ${address}`);

  let additive = args.additive;
  for (const group of groups) {
    writeFileSync(
      runFile,
      JSON.stringify({
        urls: group.urls,
        runs: args.runs,
        chromePath,
        cookie: group.cookie,
        outputDir: reports,
      }),
    );
    const status = lhci("collect", work, runFile, additive ? ["--additive"] : []);
    if (status !== 0) return status;
    additive = true;
  }
  const asserted = lhci("assert", work, runFile);
  const uploaded = lhci("upload", work, runFile);

  const all = readReports(reports);
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
