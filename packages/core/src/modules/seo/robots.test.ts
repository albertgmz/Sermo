import { expect, test } from "bun:test";
import { robotsTxt } from ".";

const BODY = robotsTxt("https://forum.example.test");

type Group = { agents: string[]; rules: { allow: boolean; path: string }[]; lines: string[] };

// The groups as RFC 9309 reads them: consecutive user-agent lines open a group, the lines up to the
// next user-agent line are its rules.
function groups(body: string): Group[] {
  const found: Group[] = [];
  let open = false;
  for (const line of body.split("\n")) {
    const colon = line.indexOf(":");
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (!open) found.push({ agents: [], rules: [], lines: [] });
      found.at(-1)?.agents.push(value);
      open = true;
      continue;
    }
    if (line.trim() !== "") open = false;
    if (key === "sitemap" || line.trim() === "") continue;
    const group = found.at(-1);
    if (!group) throw new Error(`a rule outside any group: ${line}`);
    group.lines.push(line);
    if (key === "allow" || key === "disallow")
      group.rules.push({ allow: key === "allow", path: value });
  }
  return found;
}

// Whether a crawler may fetch a path: the group that names it, else `*`; the longest matching rule
// wins, Allow on a tie, and no rule means allowed.
function allowed(agent: string, path: string) {
  const all = groups(BODY);
  const group =
    all.find((each) => each.agents.some((name) => name.toLowerCase() === agent.toLowerCase())) ??
    all.find((each) => each.agents.includes("*"));
  if (!group) throw new Error("no group for every crawler");
  let best: { allow: boolean; path: string } | undefined;
  for (const rule of group.rules) {
    if (!path.startsWith(rule.path)) continue;
    if (
      !best ||
      rule.path.length > best.path.length ||
      (rule.path.length === best.path.length && rule.allow)
    )
      best = rule;
  }
  return best?.allow ?? true;
}

const CRAWLERS = [
  "Googlebot",
  "Bingbot",
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "anthropic-ai",
  "Google-Extended",
  "Applebot-Extended",
  "PerplexityBot",
  "Perplexity-User",
  "Bytespider",
  "CCBot",
];

test("account, staff, search, sign-in, API and MCP addresses are closed to every crawler", () => {
  for (const agent of CRAWLERS)
    for (const path of [
      "/account",
      "/account/security",
      "/account/picture",
      "/conversations",
      "/conversations/5",
      "/notifications",
      "/admin",
      "/admin/settings",
      "/admin/uploads",
      "/moderation",
      "/moderation/reports",
      "/search",
      "/search?q=hello",
      "/login",
      "/login?next=%2Faccount",
      "/register",
      "/forgot-password",
      "/reset-password",
      "/verify-email",
      "/not-me",
      "/sign-out",
      "/api/v1/me",
      "/api/v1/search?q=x",
      "/api/auth/sign-in/username",
      "/mcp",
    ])
      expect({ agent, path, allowed: allowed(agent, path) }).toEqual({
        agent,
        path,
        allowed: false,
      });
});

test("the forum and the files for crawlers and agents stay open to every crawler", () => {
  for (const agent of CRAWLERS)
    for (const path of [
      "/",
      "/forums",
      "/forums/3-general",
      "/threads/7-hello",
      "/threads/7-hello?page=2",
      "/threads/7.md",
      "/forums/3.md",
      "/members/2-ann",
      "/tags/news",
      "/pages/terms",
      "/terms",
      "/developer",
      "/robots.txt",
      "/llms.txt",
      "/llms-full.txt",
      "/sitemap.xml",
      "/sitemaps/thread-1.xml",
      "/feed.atom",
      "/forums/3/feed.atom",
      "/.well-known/security.txt",
      "/.well-known/api-catalog",
      "/.well-known/gpc.json",
      "/og/site",
      "/og/thread/7",
      "/opensearch.xml",
      "/api/v1/files/12",
      "/api/v1/openapi.json",
    ])
      expect({ agent, path, allowed: allowed(agent, path) }).toEqual({
        agent,
        path,
        allowed: true,
      });
});

test("the model makers' crawlers are named in groups of their own, each with every rule of the general group", () => {
  const all = groups(BODY);
  const general = all.find((each) => each.agents.includes("*"));
  expect(general).toBeDefined();
  expect(all.at(-1)).toBe(general);
  const named = all.flatMap((each) => each.agents).filter((agent) => agent !== "*");
  expect(named.sort()).toEqual(
    CRAWLERS.filter((agent) => !["Googlebot", "Bingbot"].includes(agent)).sort(),
  );
  // Training crawlers and the ones that fetch a page to answer apart.
  expect(all.find((each) => each.agents.includes("GPTBot"))?.agents).not.toContain("OAI-SearchBot");
  for (const group of all) expect(group.lines).toEqual(general?.lines ?? []);
});

test("every group says search, live answers and training are allowed, in one Content-Signal line", () => {
  for (const group of groups(BODY)) {
    const signals = group.lines.filter((line) => line.toLowerCase().startsWith("content-signal"));
    expect(signals).toEqual(["Content-Signal: search=yes, ai-input=yes, ai-train=yes"]);
  }
  expect(BODY).not.toContain("Content-Signals:");
});

test("the sitemap line names the site's own sitemap, once, outside the groups", () => {
  expect(BODY.match(/^Sitemap: .*$/gm)).toEqual([
    "Sitemap: https://forum.example.test/sitemap.xml",
  ]);
  expect(BODY.endsWith("\n\nSitemap: https://forum.example.test/sitemap.xml\n")).toBe(true);
  expect(robotsTxt("https://other.example/")).toContain(
    "Sitemap: https://other.example/sitemap.xml\n",
  );
});

test("nothing closes the whole site, and the file is plain lines", () => {
  expect(BODY).not.toMatch(/^Disallow: \/?$/m);
  expect(BODY).not.toContain("\r");
  for (const line of BODY.split("\n"))
    expect(
      line === "" || /^(User-agent|Allow|Disallow|Content-Signal|Sitemap): \S/.test(line),
    ).toBe(true);
});
