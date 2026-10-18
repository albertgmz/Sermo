import { GUEST } from "../../actor";
import type { Ctx } from "../../context";
import { getNodeTree, viewableNodeIds } from "../../permissions";
import { requireSiteOpenToGuests } from "../members/site-access";
import { readSiteSettings } from "../settings";
import { canonicalUrl, markdownUrl, requireBaseURL } from "./paths";

/** The most forums /llms.txt lists; the sitemap has the rest. */
export const LLMS_FORUM_CAP = 200;

/** The longest note after a forum link, in characters. */
const NOTE_CAP = 200;

const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();
/** One line of text that cannot become a link, a tag or a code span when read as Markdown. */
export const plain = (value: string) => oneLine(value).replace(/[\\[\]()<>`]/g, "\\$&");
/** At most NOTE_CAP characters, cut on a word, with an ellipsis. */
export function note(value: string): string {
  const text = oneLine(value);
  if (text.length <= NOTE_CAP) return plain(text);
  const cut = text.slice(0, NOTE_CAP);
  const space = cut.lastIndexOf(" ");
  return `${plain((space > 0 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, ""))}…`;
}

/**
 * The llms.txt summary of the site (llmstxt.org format): the site's name and description, the
 * forums a guest can see grouped by category, and the machine-readable interfaces. Hidden or
 * permission-restricted forums are never listed.
 */
export function llmsTxt(ctx: Ctx, baseURL: string): string {
  const origin = requireBaseURL(baseURL);
  requireSiteOpenToGuests(ctx);
  const settings = readSiteSettings(ctx);
  const siteName = plain(settings.siteName) || "Forum";
  const description = plain(settings.siteDescription);
  const at = (path: string) => new URL(path, origin).href;

  const tree = getNodeTree(ctx);
  const visible = new Set(viewableNodeIds(ctx, GUEST));
  const groups = new Map<number | null, string[]>();
  const titles = new Map<number | null, string>([[null, "Forums"]]);
  let listed = 0;
  let truncated = false;
  for (const entry of tree.entries) {
    if (entry.type !== "forum" || !visible.has(entry.id)) continue;
    if (listed >= LLMS_FORUM_CAP) {
      truncated = true;
      break;
    }
    listed++;
    const category = tree.ancestors(entry.id).findLast((parent) => parent.type === "category");
    const key = category?.id ?? null;
    if (category) titles.set(key, plain(category.title));
    const about = note(entry.description);
    const line = `- [${plain(entry.title)}](${markdownUrl(canonicalUrl(baseURL, "node", entry.id, entry.title))})${about ? `: ${about}` : ""}`;
    const lines = groups.get(key);
    if (lines) lines.push(line);
    else groups.set(key, [line]);
  }

  const parts = [`# ${siteName}`, `> ${description || `${siteName} is a discussion forum.`}`];
  parts.push(
    `Public forums, threads and member profiles are readable without an account. Every public forum and thread page also has a Markdown version at its address with \`.md\` added (a later page of a thread adds \`?page=\` after it); the forums below link theirs.${truncated ? ` Only the first ${LLMS_FORUM_CAP} forums are listed here; the sitemap lists every public page.` : ""}`,
  );
  for (const [key, lines] of groups) parts.push(`## ${titles.get(key)}\n\n${lines.join("\n")}`);
  parts.push(
    `## Interfaces\n\n- [OpenAPI description](${at("/api/v1/openapi.json")}): every REST operation and its permissions, as JSON\n- [MCP server](${at("/mcp")}): the same operations as tools over streamable HTTP; send an API key as a Bearer token`,
  );
  parts.push(
    `## Optional\n\n- [Full text](${at("/llms-full.txt")}): the forums listed here with their newest threads, in Markdown\n- [Atom feed](${at("/feed.atom")}): the newest public threads\n- [Sitemap](${at("/sitemap.xml")}): every public forum, thread and member page`,
  );
  return `${parts.join("\n\n")}\n`;
}
