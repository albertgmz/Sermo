import { requireBaseURL } from "./paths";

// What crawlers may fetch: everything public, but not the API (its uploaded files and its own
// description excepted), search results, a member's own pages or the sign-in pages. Paths are
// prefixes of the public address (the web app's language segment never shows in it). Everything
// else stays open: the forum, `/llms.txt`, `/llms-full.txt`, the `.md` copies, `/.well-known/`, the
// share cards under `/og/`, the sitemap, the feeds and `/mcp` (POST only; `llms.txt` and the API
// catalog name it). The staff panel is not named: it answers a guest as an address that does not
// exist, and a line here would tell everyone where it is.
const PATH_RULES = [
  "Allow: /api/v1/files/",
  "Allow: /api/v1/openapi.json",
  "Disallow: /api/",
  "Disallow: /search",
  "Disallow: /account",
  "Disallow: /conversations",
  "Disallow: /notifications",
  "Disallow: /login",
  "Disallow: /register",
  "Disallow: /forgot-password",
  "Disallow: /reset-password",
  "Disallow: /verify-email",
  "Disallow: /not-me",
  "Disallow: /sign-out",
];

// Whether the content may go into a model's training data. There is no site setting for it, so it
// may. Only the training crawlers' group says it; search and live answers stay allowed for all.
const TRAINING_ALLOWED = true;

const yesNo = (allowed: boolean) => (allowed ? "yes" : "no");

// How the content may be used, in the Content Signals vocabulary.
const contentSignal = (training: boolean) =>
  `Content-Signal: search=yes, ai-input=yes, ai-train=${yesNo(training)}`;

type Group = { agents: string[]; rules: string[]; signal: string };

// The model makers' crawlers are named so the choice is explicit for each, the ones that collect
// training data apart from the ones that fetch a page to answer a question. A crawler follows only
// the most specific group that names it, so every group carries all the path rules.
function groups(training: boolean): Group[] {
  return [
    {
      agents: [
        "GPTBot",
        "ClaudeBot",
        "anthropic-ai",
        "Google-Extended",
        "Applebot-Extended",
        "CCBot",
        "Bytespider",
      ],
      rules: PATH_RULES,
      signal: contentSignal(training),
    },
    {
      agents: [
        "OAI-SearchBot",
        "ChatGPT-User",
        "Claude-SearchBot",
        "Claude-User",
        "PerplexityBot",
        "Perplexity-User",
      ],
      rules: PATH_RULES,
      signal: contentSignal(true),
    },
    { agents: ["*"], rules: PATH_RULES, signal: contentSignal(true) },
  ];
}

// The route passes only the address; `training` is there so the other answer can be checked.
export function robotsTxt(baseURL: string, training = TRAINING_ALLOWED): string {
  const sitemap = new URL("/sitemap.xml", requireBaseURL(baseURL)).href;
  const body = groups(training).map(({ agents, rules, signal }) =>
    [...agents.map((agent) => `User-agent: ${agent}`), ...rules, signal].join("\n"),
  );
  return `${body.join("\n\n")}\n\nSitemap: ${sitemap}\n`;
}
