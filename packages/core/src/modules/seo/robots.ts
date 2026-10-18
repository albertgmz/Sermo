import { requireBaseURL } from "./paths";

// What crawlers may fetch: everything public, but not the API (its uploaded files and its own
// description excepted), the MCP endpoint, search results, a member's own pages, the staff panel
// or the sign-in pages. Paths are prefixes of the public address (the web app's language segment
// never shows in it). Everything else stays open: the forum, `/llms.txt`, `/llms-full.txt`, the
// `.md` copies, `/.well-known/`, the share cards under `/og/`, the sitemap and the feeds.
const RULES = [
  "Allow: /api/v1/files/",
  "Allow: /api/v1/openapi.json",
  "Disallow: /api/",
  "Disallow: /mcp",
  "Disallow: /search",
  "Disallow: /account",
  "Disallow: /conversations",
  "Disallow: /notifications",
  "Disallow: /admin",
  "Disallow: /moderation",
  "Disallow: /login",
  "Disallow: /register",
  "Disallow: /forgot-password",
  "Disallow: /reset-password",
  "Disallow: /verify-email",
  "Disallow: /not-me",
  "Disallow: /sign-out",
];

// How the content may be used, in the Content Signals vocabulary. There is no site setting for
// it: search, live answers and model training are all allowed.
const CONTENT_SIGNAL = "Content-Signal: search=yes, ai-input=yes, ai-train=yes";

// The model makers' crawlers are named so the choice is explicit for each, the ones that collect
// training data apart from the ones that fetch a page to answer a question. A crawler follows only
// the most specific group that names it, so every group carries all the rules.
const GROUPS = [
  [
    "GPTBot",
    "ClaudeBot",
    "anthropic-ai",
    "Google-Extended",
    "Applebot-Extended",
    "CCBot",
    "Bytespider",
  ],
  [
    "OAI-SearchBot",
    "ChatGPT-User",
    "Claude-SearchBot",
    "Claude-User",
    "PerplexityBot",
    "Perplexity-User",
  ],
  ["*"],
];

export function robotsTxt(baseURL: string): string {
  const sitemap = new URL("/sitemap.xml", requireBaseURL(baseURL)).href;
  const groups = GROUPS.map((agents) =>
    [...agents.map((agent) => `User-agent: ${agent}`), ...RULES, CONTENT_SIGNAL].join("\n"),
  );
  return `${groups.join("\n\n")}\n\nSitemap: ${sitemap}\n`;
}
