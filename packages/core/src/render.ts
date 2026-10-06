import { convert } from "html-to-text";
import type { Tokens } from "marked";
import { Marked } from "marked";
import sanitizeHtml from "sanitize-html";
import type { Actor } from "./actor";
import { actorUserId } from "./actor";
import { type Ctx, prepared } from "./context";
import { ValidationError } from "./errors";
import {
  containerExtension,
  inlineSpoilerExtension,
  inlineSpoilerLineExtension,
  mentionExtension,
} from "./markdown/extensions";
import {
  can,
  memberActor,
  PRINCIPAL_COLUMNS,
  type PrincipalRow,
  permissionValue,
  requestVersions,
} from "./permissions";

/**
 * Markdown -> sanitized HTML: the one function every content type (posts, profile posts,
 * profile post comments, conversation messages) uses at write time; reads serve the stored HTML.
 * Raw HTML in the source is escaped by sanitize-html (shown literally), and the rendered output
 * then passes through sanitize-html with the allowlist below.
 */
const ESCAPE_ALL: sanitizeHtml.IOptions = {
  allowedTags: [],
  allowedAttributes: {},
  disallowedTagsMode: "recursiveEscape",
};

function markedFor(source: string): Marked {
  return new Marked({
    gfm: true,
    breaks: true,
    async: false,
    renderer: {
      html({ text }) {
        return sanitizeHtml(text, ESCAPE_ALL);
      },
    },
    extensions: [
      ...(source.includes(":::quote") || source.includes(":::spoiler") ? [containerExtension] : []),
      ...(source.includes("!<") ? [inlineSpoilerLineExtension, inlineSpoilerExtension] : []),
      ...(source.includes("@") ? [mentionExtension] : []),
    ],
  });
}

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "hr",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "blockquote",
    "details",
    "summary",
    "cite",
    "span",
    "pre",
    "code",
    "ul",
    "ol",
    "li",
    "strong",
    "em",
    "del",
    "a",
    "img",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "input",
  ],
  allowedAttributes: {
    a: ["href", "title", "rel", "class", "data-user-id"],
    blockquote: ["class", "data-post-id"],
    details: ["class"],
    span: ["class"],
    img: ["src", "alt", "title"],
    ol: ["start"],
    th: ["align"],
    td: ["align"],
    input: [
      { name: "type", values: ["checkbox"] },
      { name: "checked", values: ["", "checked"] },
      { name: "disabled", values: ["", "disabled"] },
    ],
  },
  allowedClasses: {
    code: ["language-*"],
    a: ["mention"],
    blockquote: ["quote"],
    details: ["spoiler"],
    span: ["spoiler"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https"] },
  allowProtocolRelative: false,
  disallowedTagsMode: "escape",
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "nofollow ugc noopener" }),
  },
};

/**
 * Rendering cost grows faster than linearly on adversarial input; at 10,000 characters the
 * worst cases measured stay around 45 ms. Deep quote nesting overflows the parser's stack.
 */
export const MAX_BODY_LENGTH = 10_000;
const MAX_QUOTE_DEPTH = 10;
const TOO_DEEP_QUOTES = new RegExp(`^(?:[ \t]{0,3}>){${MAX_QUOTE_DEPTH + 1}}`, "m");

/** Throws ValidationError for input that cannot be rendered safely. */
export function renderMarkdown(source: string): string {
  return render(source).html;
}

type ContentType = "post" | "profile_post" | "profile_post_comment" | "conversation_message";
export interface ContentReferences {
  mentionedUserIds: number[];
  quotes: { postId: number; userId: number }[];
}

function canonicalSource(source: string, tokens: Tokens.Generic[]): string {
  let position = 0;
  let result = "";
  for (const token of tokens) {
    const start = source.indexOf(token.raw, position);
    if (start < 0) continue;
    result += source.slice(position, start);
    let raw = token.raw;
    if (token.type === "sermoContainer") {
      const open = token.openRaw as string;
      const body = token.bodyRaw as string;
      const close = raw.slice(open.length + body.length);
      const canonicalOpen =
        token.kind === "quote" && token.resolvedAuthor
          ? open.replace(
              /^:::quote\{[^}]*\}/,
              `:::quote{post=${token.postId} author="${token.resolvedAuthor}"}`,
            )
          : open;
      raw = canonicalOpen + canonicalSource(body, token.tokens ?? []) + close;
    } else if (token.tokens?.length) {
      raw = canonicalSource(raw, token.tokens);
    }
    result += raw;
    position = start + token.raw.length;
  }
  return result + source.slice(position);
}

function canonicalQuoteLines(source: string, quotes: Tokens.Generic[]): string {
  const authors = new Map<number, string>();
  for (const quote of quotes)
    if (quote.resolvedAuthor) authors.set(Number(quote.postId), quote.resolvedAuthor);
  if (!authors.size) return source;
  let fence: string | null = null;
  return source
    .split("\n")
    .map((line) => {
      const withoutPrefix = line.replace(/^\s*(?:(?:>\s*)|(?:(?:[-*+]|\d+\.)\s+))*/, "");
      const marker = /^(`{3,}|~{3,})/.exec(withoutPrefix)?.[1];
      if (marker) {
        if (!fence) fence = marker[0]!;
        else if (marker[0] === fence && marker.length >= 3) fence = null;
        return line;
      }
      if (fence) return line;
      const match =
        /^(\s*(?:(?:>\s*)|(?:(?:[-*+]|\d+\.)\s+))*):::quote\{post=(\d+)(?: author="[^"]*")?\}([ \t]*)$/.exec(
          line,
        );
      if (!match) return line;
      const author = authors.get(Number(match[2]));
      return author ? `${match[1]}:::quote{post=${match[2]} author="${author}"}${match[3]}` : line;
    })
    .join("\n");
}

function previousMentions(html: string): Map<string, { id: number; label: string }> {
  const mentions = new Map<string, { id: number; label: string }>();
  convert(html, {
    selectors: [{ selector: "a.mention", format: "captureMention" }],
    formatters: {
      captureMention(element, walk, builder) {
        const id = Number(element.attribs?.["data-user-id"]);
        const label = element.children.map((child) => child.data ?? "").join("");
        if (Number.isSafeInteger(id) && id > 0 && label.startsWith("@")) {
          mentions.set(label.slice(1).toLowerCase(), { id, label: label.slice(1) });
        }
        walk(element.children, builder);
      },
    },
  });
  return mentions;
}

type ContentEdit = { contentType: ContentType; contentId: number; authorId: number };

function previousContent(ctx: Ctx, edit?: ContentEdit) {
  if (!edit)
    return {
      mentions: new Map<string, { id: number; label: string }>(),
      quotes: new Map<number, number>(),
    };
  const source = {
    post: "SELECT body_html FROM post_bodies WHERE post_id = ?1",
    profile_post: "SELECT body_html FROM profile_posts WHERE id = ?1",
    profile_post_comment: "SELECT body_html FROM profile_post_comments WHERE id = ?1",
    conversation_message: "SELECT body_html FROM conversation_messages WHERE id = ?1",
  }[edit.contentType];
  const row = ctx.sqlite.prepare<{ body_html: string }, [number]>(source).get(edit.contentId);
  const quotes = prepared(ctx, "markdown.previousQuotes", () =>
    ctx.sqlite.prepare<{ quoted_post_id: number; quoted_user_id: number }, [string, number]>(
      "SELECT quoted_post_id, quoted_user_id FROM content_quotes WHERE content_type = ?1 AND content_id = ?2",
    ),
  ).all(edit.contentType, edit.contentId);
  return {
    mentions: previousMentions(row?.body_html ?? ""),
    quotes: new Map(quotes.map((quote) => [quote.quoted_post_id, quote.quoted_user_id])),
  };
}

function checkQuoteDepth(tokens: Tokens.Generic[], depth = 0): void {
  for (const token of tokens) {
    const next =
      depth +
      Number(
        token.type === "blockquote" || (token.type === "sermoContainer" && token.kind === "quote"),
      );
    if (next > MAX_QUOTE_DEPTH)
      throw new ValidationError("Containers are nested too deeply.", [
        {
          path: ["body"],
          message: `Containers may be nested at most ${MAX_QUOTE_DEPTH} levels deep.`,
        },
      ]);
    if (token.tokens) checkQuoteDepth(token.tokens, next);
    if (token.items) for (const item of token.items) checkQuoteDepth(item.tokens ?? [], next);
  }
}

function render(
  source: string,
  ctx?: Ctx,
  actor?: Actor,
  edit?: ContentEdit,
): ContentReferences & { html: string; source: string } {
  source = source.replace(/\r\n?/g, "\n");
  if (TOO_DEEP_QUOTES.test(source)) {
    throw new ValidationError("Containers are nested too deeply.", [
      {
        path: ["body"],
        message: `Containers may be nested at most ${MAX_QUOTE_DEPTH} levels deep.`,
      },
    ]);
  }
  let html: string;
  let storedSource = source;
  const mentionedUserIds: number[] = [];
  const quotes: { postId: number; userId: number }[] = [];
  try {
    const marked = markedFor(source);
    const tokens = marked.lexer(source);
    checkQuoteDepth(tokens as Tokens.Generic[]);
    const mentions: Tokens.Generic[] = [];
    const quoteTokens: Tokens.Generic[] = [];
    marked.walkTokens(tokens, (token) => {
      if (token.type === "sermoMention") mentions.push(token as Tokens.Generic);
      if (token.type === "sermoContainer" && token.kind === "quote")
        quoteTokens.push(token as Tokens.Generic);
      if (token.type === "link" || token.type === "image") {
        marked.walkTokens(token.tokens ?? [], (child) => {
          if (child.type === "sermoMention") child.blocked = true;
        });
      }
    });
    if (ctx && actor) {
      const previous = previousContent(ctx, edit);
      const names = [
        ...new Set(
          mentions
            .filter((t) => !t.blocked && !previous.mentions.has(String(t.name).toLowerCase()))
            .map((t) => String(t.name).toLowerCase()),
        ),
      ];
      const users = names.length
        ? prepared(ctx, "markdown.mentionUsers", () =>
            ctx.sqlite.prepare<{ id: number; username: string; username_key: string }, [string]>(
              "SELECT id, username, username_key FROM users WHERE username_key IN (SELECT value FROM json_each(?1))",
            ),
          ).all(JSON.stringify(names))
        : [];
      const byName = new Map(users.map((user) => [user.username_key, user]));
      const { readSiteSettings } =
        require("./modules/settings") as typeof import("./modules/settings");
      const setting = readSiteSettings(ctx);
      const editorId = actorUserId(actor);
      const userId = edit?.authorId ?? editorId;
      const createdAt =
        userId == null
          ? null
          : prepared(ctx, "markdown.authorAge", () =>
              ctx.sqlite.prepare<{ created_at: number }, [number]>(
                "SELECT created_at FROM users WHERE id = ?1",
              ),
            ).get(userId)?.created_at;
      let author = actor;
      if (edit && edit.authorId !== actorUserId(actor)) {
        const row = prepared(ctx, "markdown.authorPrincipal", () =>
          ctx.sqlite.prepare<PrincipalRow & { id: number; group_id: number }, [number]>(
            `SELECT u.id, u.group_id, ${PRINCIPAL_COLUMNS} FROM users u WHERE u.id = ?1`,
          ),
        ).get(edit.authorId);
        if (!row) throw new ValidationError("The content author no longer exists.");
        author = memberActor(row.id, row.group_id, row, requestVersions(ctx, actor));
      }
      const permissionLimit = permissionValue(ctx, author, "mention.maxPerItem");
      const newMember =
        createdAt != null && createdAt > ctx.now() - (setting.newMemberDays ?? 7) * 86_400_000;
      const limit = newMember
        ? permissionLimit < 0
          ? (setting.newMemberMentionLimit ?? 3)
          : Math.min(permissionLimit, setting.newMemberMentionLimit ?? 3)
        : permissionLimit;
      const accepted = new Set<number>();
      for (const token of mentions) {
        if (token.blocked) continue;
        const old = previous.mentions.get(String(token.name).toLowerCase());
        const user = byName.get(String(token.name).toLowerCase());
        const resolved = old ?? (user && { id: user.id, label: user.username });
        if (!resolved || (limit >= 0 && accepted.size >= limit && !accepted.has(resolved.id)))
          continue;
        token.userId = resolved.id;
        token.displayName = resolved.label;
        accepted.add(resolved.id);
      }
      mentionedUserIds.push(...accepted);

      const quoteIds = [...new Set(quoteTokens.map((token) => Number(token.postId)))];
      const rows = quoteIds.length
        ? prepared(ctx, "markdown.quotePosts", () =>
            ctx.sqlite.prepare<
              {
                id: number;
                user_id: number;
                username: string;
                post_state: string;
                thread_state: string;
                thread_user_id: number;
                node_id: number;
              },
              [string]
            >(
              "SELECT p.id, p.user_id, u.username, p.state AS post_state, t.state AS thread_state, t.user_id AS thread_user_id, t.node_id FROM posts p JOIN threads t ON t.id = p.thread_id JOIN users u ON u.id = p.user_id WHERE p.id IN (SELECT value FROM json_each(?1))",
            ),
          ).all(JSON.stringify(quoteIds))
        : [];
      const byPost = new Map(rows.map((row) => [row.id, row]));
      const visible = (state: string, ownerId: number, nodeId: number) =>
        state === "visible" ||
        (state === "moderated"
          ? ownerId === editorId || can(ctx, actor, "forum.viewModerated", { nodeId })
          : can(ctx, actor, "forum.viewDeleted", { nodeId }));
      for (const token of quoteTokens) {
        const row = byPost.get(Number(token.postId));
        if (
          !row ||
          (!previous.quotes.has(row.id) &&
            (!can(ctx, actor, "node.view", { nodeId: row.node_id }) ||
              !visible(row.thread_state, row.thread_user_id, row.node_id) ||
              !visible(row.post_state, row.user_id, row.node_id)))
        ) {
          throw new ValidationError("The quoted post is not visible.");
        }
        token.resolvedAuthor = row.username;
        if (!quotes.some((quote) => quote.postId === row.id))
          quotes.push({ postId: row.id, userId: previous.quotes.get(row.id) ?? row.user_id });
      }
    }
    storedSource = canonicalQuoteLines(
      canonicalSource(source, tokens as Tokens.Generic[]),
      quoteTokens,
    );
    html = marked.parser(tokens) as string;
  } catch (error) {
    if (error instanceof RangeError) {
      throw new ValidationError("The text is too complex to display.", [
        { path: ["body"], message: "The text is too complex to display." },
      ]);
    }
    throw error;
  }
  return {
    html: sanitizeHtml(html, SANITIZE_OPTIONS).trim(),
    source: storedSource,
    mentionedUserIds,
    quotes,
  };
}

export function renderContent(
  ctx: Ctx,
  actor: Actor,
  source: string,
  options?: { edit?: ContentEdit },
): ContentReferences & { html: string; source: string } {
  return render(source, ctx, actor, options?.edit);
}

/** Must run in the same write transaction as the content change. */
export function storeContentReferences(
  ctx: Ctx,
  contentType: ContentType,
  contentId: number,
  refs: ContentReferences,
): { newlyMentioned: number[] } {
  const old = prepared(ctx, "markdown.existingMentions", () =>
    ctx.sqlite.prepare<{ user_id: number }, [string, number]>(
      "SELECT user_id FROM content_mentions WHERE content_type = ?1 AND content_id = ?2",
    ),
  ).all(contentType, contentId);
  const previous = new Set(old.map((row) => row.user_id));
  const wanted = new Set(refs.mentionedUserIds);
  const newlyMentioned = refs.mentionedUserIds.filter((id) => !previous.has(id));
  for (const id of previous) {
    if (!wanted.has(id))
      prepared(ctx, "markdown.deleteMention", () =>
        ctx.sqlite.prepare(
          "DELETE FROM content_mentions WHERE content_type = ?1 AND content_id = ?2 AND user_id = ?3",
        ),
      ).run(contentType, contentId, id);
  }
  for (const id of newlyMentioned)
    prepared(ctx, "markdown.insertMention", () =>
      ctx.sqlite.prepare(
        "INSERT INTO content_mentions (content_type, content_id, user_id, created_at) VALUES (?1, ?2, ?3, ?4)",
      ),
    ).run(contentType, contentId, id, ctx.now());
  prepared(ctx, "markdown.clearQuotes", () =>
    ctx.sqlite.prepare("DELETE FROM content_quotes WHERE content_type = ?1 AND content_id = ?2"),
  ).run(contentType, contentId);
  for (const quote of refs.quotes)
    prepared(ctx, "markdown.insertQuote", () =>
      ctx.sqlite.prepare(
        "INSERT INTO content_quotes (content_type, content_id, quoted_post_id, quoted_user_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      ),
    ).run(contentType, contentId, quote.postId, quote.userId, ctx.now());
  return { newlyMentioned };
}

export function renderPlainText(html: string, maxLength?: number): string {
  const result = convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "a", options: { linkBrackets: [" (", ")"] } },
      { selector: "a.mention", format: "inline" },
      { selector: "cite > a", format: "inline" },
      { selector: 'a[href^="mailto:"]', format: "mailto" },
      ...["h1", "h2", "h3", "h4", "h5", "h6"].map((selector) => ({
        selector,
        options: { uppercase: false },
      })),
      { selector: "details.spoiler", format: "spoiler" },
      { selector: "span.spoiler", format: "spoiler" },
    ],
    formatters: {
      spoiler(_element, _walk, builder) {
        builder.addInline("[spoiler]");
      },
      mailto(element, _walk, builder) {
        const address = String(element.attribs?.href ?? "").replace(/^mailto:/i, "");
        const label = element.children.map((child) => child.data ?? "").join("");
        builder.addInline(label === address ? label : `${label} (${address})`);
      },
    },
  }).trim();
  if (maxLength == null || result.length <= maxLength) return result;
  if (maxLength <= 1) return "…".slice(0, Math.max(0, maxLength));
  const fragment = result.slice(0, maxLength - 1);
  const boundary = fragment.search(/\s+\S*$/);
  return `${(boundary > 0 ? fragment.slice(0, boundary) : "").trimEnd()}…`;
}
