import { convert } from "html-to-text";
import sanitizeHtml from "sanitize-html";
import type { Actor } from "./actor";
import { actorUserId } from "./actor";
import { Deadline, RENDER_LIMIT_MS, TOO_COMPLEX } from "./bbcode/deadline";
import { blockCount, renderTree, type SpoilerSink } from "./bbcode/html";
import { MEDIA_ALLOW, MEDIA_IFRAME_HOSTS, MEDIA_SANDBOX } from "./bbcode/media";
import { COLOR_STYLE, lex, pair } from "./bbcode/scan";
import { build, type El, type HashtagNode, quoteTag } from "./bbcode/tree";
import { type Ctx, prepared } from "./context";
import { ValidationError } from "./errors";
import { MAX_BODY_LENGTH } from "./limits";
import { readGates } from "./modules/forums/read-gates";
import { knownTagNames } from "./modules/tags/store";
import {
  can,
  memberActor,
  PRINCIPAL_COLUMNS,
  type PrincipalRow,
  permissionValue,
  requestVersions,
} from "./permissions";

/**
 * BB code -> sanitized HTML: the one function every content type (posts, profile posts,
 * profile post comments, conversation messages) uses at write time; reads serve the stored HTML.
 * Tags are read by a linear parser (`bbcode/`); anything it does not recognise, HTML and Markdown
 * included, is shown as typed, and the HTML then passes through sanitize-html with the allowlist
 * below. Reading a message may take `RENDER_LIMIT_MS`; past that it is refused as too complex.
 */

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
    "div",
    "u",
    "iframe",
  ],
  allowedAttributes: {
    a: ["href", "rel", "class", "data-user-id"],
    blockquote: ["class", "data-post-id"],
    details: ["class"],
    summary: ["class"],
    cite: ["class"],
    div: ["class", "data-spoiler", "data-spoiler-title"],
    pre: ["class"],
    table: ["class"],
    span: ["class", "style", "data-spoiler", "data-attach-id", "data-attach-size"],
    iframe: [
      "src",
      "class",
      { name: "loading", values: ["lazy"] },
      { name: "sandbox", values: [MEDIA_SANDBOX] },
      { name: "allow", values: MEDIA_ALLOW },
      { name: "referrerpolicy", values: ["strict-origin-when-cross-origin"] },
      { name: "allowfullscreen", values: [""] },
      "data-media-url",
    ],
    img: ["src", "alt"],
  },
  allowedClasses: {
    code: ["language-*"],
    a: ["mention", "hashtag", "bb-*"],
    blockquote: ["quote", "bb-quote"],
    details: ["spoiler"],
    summary: ["bb-*"],
    cite: ["bb-quote-author"],
    div: ["bb-*"],
    pre: ["hljs", "language-*"],
    table: ["bb-table"],
    iframe: ["bb-*"],
    span: ["spoiler", "hljs-*", "bb-*"],
  },
  allowedStyles: { span: { color: [COLOR_STYLE] } },
  allowedIframeHostnames: [...MEDIA_IFRAME_HOSTS],
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https"] },
  allowProtocolRelative: false,
  disallowedTagsMode: "escape",
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "nofollow ugc noopener" }),
  },
};

/**
 * What a render may do with the `#tags` of the text. Without it they stay as typed. Tags that
 * exist become links. `slots` is how many tags the content may put on its thread (0: it only
 * links); with `create`, a tag nobody used yet takes one of the slots and links too.
 */
export interface HashtagRules {
  create: boolean;
  slots: number;
}

interface RenderTiming {
  /** Test hook: the clock the render deadline reads (milliseconds). */
  clock?: () => number;
  limitMs?: number;
  hashtags?: HashtagRules;
}

/**
 * Throws ValidationError for input that cannot be rendered safely. Mentions and quotes are not
 * resolved (no actor). `maxLength` raises the length the rendered source may reach (default
 * MAX_BODY_LENGTH); only text written by administrators should pass it.
 */
export function renderBbCode(
  source: string,
  options: { maxLength?: number } & RenderTiming = {},
): string {
  return render(source, undefined, undefined, undefined, options.maxLength, options).html;
}

/** How many paragraphs and blocks a source holds at its top level (a signature may hold one). */
export function countBlocks(source: string): number {
  const text = source.replace(/\r\n?/g, "\n");
  const deadline = new Deadline();
  deadline.resume();
  const toks = lex(text, deadline);
  pair(toks, deadline);
  return blockCount(build(text, toks, deadline).kids);
}

type ContentType = "post" | "profile_post" | "profile_post_comment" | "conversation_message";
export interface ContentReferences {
  mentionedUserIds: number[];
  quotes: { postId: number; userId: number }[];
}
/** What a render returns; `spoilers` is the sanitized HTML of each spoiler by position. */
type Rendered = ContentReferences & {
  html: string;
  source: string;
  spoilers: string[];
  /** The tags (names) the text puts on its thread, at most `slots`, in order of appearance. */
  hashtags: string[];
};

/** The source with each quote's opening tag naming its author and member (resolved) or only its author. */
function canonicalSource(source: string, quotes: El[]): string {
  let result = "";
  let position = 0;
  for (const el of quotes) {
    const quote = el.quote!;
    // A quote an import could not link keeps only its author's name, so the stored text, the
    // HTML and a later edit agree that it is not a reference to a post.
    const tag = quote.resolvedAuthor
      ? quoteTag(quote.resolvedAuthor, `post: ${quote.postId}, member: ${quote.userId}`)
      : quote.author
        ? quoteTag(quote.author)
        : "[QUOTE]";
    result += `${source.slice(position, el.start)}${tag}`;
    position = el.end;
  }
  return result + source.slice(position);
}

function previousRenderedReferences(html: string) {
  const mentions = new Map<string, { id: number; label: string }>();
  const quoteAuthors = new Map<number, string>();
  convert(html, {
    selectors: [
      { selector: "a.mention", format: "captureMention" },
      { selector: "blockquote.quote", format: "captureQuote" },
    ],
    formatters: {
      captureMention(element, walk, builder) {
        const id = Number(element.attribs?.["data-user-id"]);
        const label = element.children.map((child) => child.data ?? "").join("");
        if (Number.isSafeInteger(id) && id > 0 && label.startsWith("@")) {
          mentions.set(label.slice(1).toLowerCase(), { id, label: label.slice(1) });
        }
        walk(element.children, builder);
      },
      captureQuote(element, walk, builder) {
        const id = Number(element.attribs?.["data-post-id"]);
        const citation = element.children.find((child) => child.name === "cite");
        const link = citation?.children.find((child) => child.name === "a");
        const author = link?.children.map((child) => child.data ?? "").join("");
        if (Number.isSafeInteger(id) && id > 0 && author) quoteAuthors.set(id, author);
        walk(element.children, builder);
      },
    },
  });
  return { mentions, quoteAuthors };
}

type ContentEdit = { contentType: ContentType; contentId: number; authorId: number };

function previousContent(ctx: Ctx, edit?: ContentEdit) {
  if (!edit)
    return {
      mentions: new Map<string, { id: number; label: string }>(),
      mentionedUserIds: new Set<number>(),
      quoteAuthors: new Map<number, string>(),
      quotes: new Map<number, number>(),
    };
  const source = {
    post: "SELECT body_html FROM post_bodies WHERE post_id = ?1",
    profile_post: "SELECT body_html FROM profile_posts WHERE id = ?1",
    profile_post_comment: "SELECT body_html FROM profile_post_comments WHERE id = ?1",
    conversation_message: "SELECT body_html FROM conversation_messages WHERE id = ?1",
  }[edit.contentType];
  const row = ctx.sqlite.prepare<{ body_html: string }, [number]>(source).get(edit.contentId);
  const mentions = prepared(ctx, "markdown.existingMentions", () =>
    ctx.sqlite.prepare<{ user_id: number }, [string, number]>(
      "SELECT user_id FROM content_mentions WHERE content_type = ?1 AND content_id = ?2",
    ),
  ).all(edit.contentType, edit.contentId);
  const quotes = prepared(ctx, "markdown.previousQuotes", () =>
    ctx.sqlite.prepare<{ quoted_post_id: number; quoted_user_id: number }, [string, number]>(
      "SELECT quoted_post_id, quoted_user_id FROM content_quotes WHERE content_type = ?1 AND content_id = ?2",
    ),
  ).all(edit.contentType, edit.contentId);
  return {
    ...previousRenderedReferences(row?.body_html ?? ""),
    mentionedUserIds: new Set(mentions.map((mention) => mention.user_id)),
    quotes: new Map(quotes.map((quote) => [quote.quoted_post_id, quote.quoted_user_id])),
  };
}

/**
 * Renders once more when the time bound trips: a slow moment (the first render after a start, a
 * garbage collection, a busy machine) is not the message's fault, and a message that is too
 * complex trips it again.
 */
function render(
  source: string,
  ctx?: Ctx,
  actor?: Actor,
  edit?: ContentEdit,
  maxLength = MAX_BODY_LENGTH,
  timing: RenderTiming = {},
  importNodeId?: number,
): Rendered {
  try {
    return renderOnce(source, ctx, actor, edit, maxLength, timing, importNodeId);
  } catch (error) {
    if (error instanceof ValidationError && error.message === TOO_COMPLEX)
      return renderOnce(source, ctx, actor, edit, maxLength, timing, importNodeId);
    throw error;
  }
}

let warmedUp = false;
const WARM_UP_SAMPLE =
  "[B]bold[/B] [URL=https://a.example]link[/URL] https://b.example @name\n\n" +
  "[QUOTE=a]q[/QUOTE]\n[LIST][*]a[*]b[/LIST]\n[TABLE][TR][TD]x[/TD][/TR][/TABLE]\n" +
  "[CODE=js]var a = 1;[/CODE] [CODE=php]echo 1;[/CODE] [MEDIA=youtube]kQ0Eo1UccEE[/MEDIA]\n" +
  "[SPOILER=t]s[/SPOILER] [ISPOILER]i[/ISPOILER] [HEADING=2]h[/HEADING] [HR]";

/**
 * Renders a small sample of every kind of tag, once per process, so the first message after a
 * start does not pay for the code and the sanitizer warming up inside its 50 ms.
 */
export function warmUpRenderer(): boolean {
  if (warmedUp) return false;
  warmedUp = true;
  for (let round = 0; round < 3; round++)
    renderBbCode(WARM_UP_SAMPLE, { limitMs: Number.POSITIVE_INFINITY });
  return true;
}

/**
 * Decides which hashtags of a text are links, with one query for all of them: a tag that exists
 * links to its current name, a new one links when the rules let it be made, and every other
 * stays as typed. Returns the tags the text puts on its thread.
 */
function resolveHashtags(
  ctx: Ctx,
  actor: Actor,
  nodes: HashtagNode[],
  rules: HashtagRules,
): string[] {
  // A tag the writer cannot see used anywhere is no tag to them: it is not linked and not refused,
  // so a link or its absence says nothing about forums they cannot open.
  const known = knownTagNames(ctx, actor, [...new Set(nodes.map((node) => node.tag))]);
  const chosen = new Map<string, string | null>();
  const attach: string[] = [];
  // Hashtags in a spoiler or a quote are not what the post says in the open: they link where they
  // are when the tag is known, and never make a tag or tag the thread.
  for (const node of nodes) {
    if (node.hidden || chosen.has(node.tag)) continue;
    const name = known.get(node.tag);
    const fits = attach.length < rules.slots;
    const link = name ?? (rules.create && fits ? node.tag : null);
    chosen.set(node.tag, link);
    if (link !== null && fits && !attach.includes(link)) attach.push(link);
  }
  for (const node of nodes)
    node.link = node.hidden
      ? (known.get(node.tag) ?? chosen.get(node.tag) ?? null)
      : (chosen.get(node.tag) ?? null);
  return attach;
}

function renderOnce(
  source: string,
  ctx?: Ctx,
  actor?: Actor,
  edit?: ContentEdit,
  maxLength = MAX_BODY_LENGTH,
  timing: RenderTiming = {},
  importNodeId?: number,
): Rendered {
  source = source.replace(/\r\n?/g, "\n");
  const deadline = new Deadline(timing.limitMs ?? RENDER_LIMIT_MS, timing.clock);
  deadline.resume();
  const toks = lex(source, deadline);
  pair(toks, deadline);
  const tree = build(source, toks, deadline);
  deadline.pause();
  const { mentions } = tree;
  const mentionedUserIds: number[] = [];
  const quotes: { postId: number; userId: number }[] = [];
  const hashtags: string[] = [];
  const sink: SpoilerSink | undefined =
    ctx && actor
      ? { html: [], sanitize: (inner) => sanitizeHtml(inner, SANITIZE_OPTIONS).trim() }
      : undefined;
  if (ctx && actor) {
    const previous = previousContent(ctx, edit);
    const names = [
      ...new Set(
        mentions
          .filter((t) => !t.hint && !previous.mentions.has(t.name.toLowerCase()))
          .map((t) => t.name.toLowerCase()),
      ),
    ];
    // [USER=id] names the member by id; the text between the tags is only a fallback.
    const hintedIds = [...new Set(mentions.filter((t) => t.hint).map((t) => t.hint))];
    const hinted = hintedIds.length
      ? prepared(ctx, "markdown.mentionUsersById", () =>
          ctx.sqlite.prepare<{ id: number; username: string }, [string]>(
            "SELECT id, username FROM users WHERE id IN (SELECT value FROM json_each(?1))",
          ),
        ).all(JSON.stringify(hintedIds))
      : [];
    const byId = new Map(hinted.map((user) => [user.id, user]));
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
    // An import keeps every mention the author wrote: the actor is not the writer.
    const limit =
      importNodeId !== undefined
        ? -1
        : newMember
          ? permissionLimit < 0
            ? (setting.newMemberMentionLimit ?? 3)
            : Math.min(permissionLimit, setting.newMemberMentionLimit ?? 3)
          : permissionLimit;
    // Mentions the content already had stay whatever the current limit is; the limit only
    // decides how many newly added members fit beside them.
    const accepted = new Set<number>();
    for (const kept of [true, false]) {
      for (const mention of mentions) {
        const old = mention.hint ? undefined : previous.mentions.get(mention.name.toLowerCase());
        const user = mention.hint ? byId.get(mention.hint) : byName.get(mention.name.toLowerCase());
        const resolved = old ?? (user && { id: user.id, label: user.username });
        if (!resolved || previous.mentionedUserIds.has(resolved.id) !== kept) continue;
        if (!kept && limit >= 0 && accepted.size >= limit && !accepted.has(resolved.id)) continue;
        mention.userId = resolved.id;
        mention.displayName = resolved.label;
        accepted.add(resolved.id);
      }
    }
    mentionedUserIds.push(...accepted);
    if (timing.hashtags)
      hashtags.push(...resolveHashtags(ctx, actor, tree.hashtags, timing.hashtags));

    const quoteIds = [...new Set(tree.quotes.map((el) => el.quote!.postId!))];
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
    // A thread other members started, and a post whose text is closed, may be closed to the
    // writer in its forum: quoting one would tell them it exists.
    const gates = readGates(ctx, actor);
    // An import never refuses a quote. A quote links only to a post, in a thread, that shows to
    // everyone, and when the quoting post is public its source forum must be public too: the
    // actor of an import sees everything, so it is not the reader to ask.
    const importing = importNodeId !== undefined;
    const guest: Actor = { kind: "guest" };
    const guestGates = importing ? readGates(ctx, guest) : gates;
    const publicQuoting = importing && can(ctx, guest, "node.view", { nodeId: importNodeId });
    const linkable = (row: (typeof rows)[number]) =>
      row.post_state === "visible" &&
      row.thread_state === "visible" &&
      (!publicQuoting ||
        (can(ctx, guest, "node.view", { nodeId: row.node_id }) &&
          guestGates.opens(row.node_id, row.thread_user_id) &&
          guestGates.reads(row.node_id, row.user_id)));
    // A post is checked once, however many times it is quoted.
    const checked = new Set<number>();
    for (const el of tree.quotes) {
      const quote = el.quote!;
      const row = byPost.get(quote.postId!);
      if (importing) {
        if (!row || !linkable(row)) continue;
      } else if (!row) throw new ValidationError("The quoted post is not visible.");
      if (!checked.has(row.id)) {
        if (
          !importing &&
          !previous.quotes.has(row.id) &&
          (!can(ctx, actor, "node.view", { nodeId: row.node_id }) ||
            !visible(row.thread_state, row.thread_user_id, row.node_id) ||
            !visible(row.post_state, row.user_id, row.node_id) ||
            !gates.opens(row.node_id, row.thread_user_id) ||
            !gates.reads(row.node_id, row.user_id))
        ) {
          throw new ValidationError("The quoted post is not visible.");
        }
        checked.add(row.id);
        quotes.push({ postId: row.id, userId: previous.quotes.get(row.id) ?? row.user_id });
      }
      quote.resolvedAuthor = previous.quoteAuthors.get(row.id) ?? row.username;
      quote.userId = previous.quotes.get(row.id) ?? row.user_id;
    }
  }
  const storedSource = canonicalSource(source, tree.quotes);
  if (storedSource.length > maxLength)
    throw new ValidationError("The text is too long once quotes are attributed.", [
      {
        path: ["body"],
        message: `The text with quote attributions may be at most ${maxLength} characters long.`,
      },
    ]);
  deadline.resume();
  const unsafe = renderTree(tree.kids, deadline, sink);
  deadline.check();
  const html = sanitizeHtml(unsafe, SANITIZE_OPTIONS).trim();
  deadline.check();
  return {
    html,
    source: storedSource,
    mentionedUserIds,
    quotes,
    spoilers: sink?.html ?? [],
    hashtags,
  };
}

/** Time a render for an import may take: a long body is not a hostile one, and the machine may be busy. */
const IMPORT_RENDER_LIMIT_MS = 1_000;

/**
 * The render of the XenForo importer, never of a request: `renderContent` without the length cap
 * and without refusing. `actor` sees everything and `nodeId` is the forum the body will live in.
 * A quote of a post that is missing, deleted or hidden stays a plain quote with the author named
 * in its tag and no link; so does a quote whose source forum a guest cannot open when a guest
 * can open `nodeId` (the quote's own text is already in the body).
 */
export function renderForImport(
  ctx: Ctx,
  actor: Actor,
  source: string,
  options: { nodeId: number } & RenderTiming,
): Rendered {
  return render(
    source,
    ctx,
    actor,
    undefined,
    Number.POSITIVE_INFINITY,
    { limitMs: IMPORT_RENDER_LIMIT_MS, ...options },
    options.nodeId,
  );
}

export function renderContent(
  ctx: Ctx,
  actor: Actor,
  source: string,
  options?: { edit?: ContentEdit } & RenderTiming,
): Rendered {
  return render(source, ctx, actor, options?.edit, undefined, options);
}

/** Replaces the stored spoilers of a body; runs in the same write transaction as the content change. */
export function storeSpoilers(
  ctx: Ctx,
  contentType: ContentType,
  contentId: number,
  spoilers: string[],
): void {
  prepared(ctx, "markdown.clearSpoilers", () =>
    ctx.sqlite.prepare("DELETE FROM content_spoilers WHERE content_type = ?1 AND content_id = ?2"),
  ).run(contentType, contentId);
  spoilers.forEach((html, position) => {
    prepared(ctx, "markdown.insertSpoiler", () =>
      ctx.sqlite.prepare(
        "INSERT INTO content_spoilers (content_type, content_id, position, html) VALUES (?1, ?2, ?3, ?4)",
      ),
    ).run(contentType, contentId, position, html);
  });
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
      { selector: "a.hashtag", format: "inline" },
      { selector: "cite > a", format: "inline" },
      { selector: 'a[href^="mailto:"]', format: "mailto" },
      ...["h1", "h2", "h3", "h4", "h5", "h6"].map((selector) => ({
        selector,
        options: { uppercase: false },
      })),
      { selector: "details.spoiler", format: "spoiler" },
      { selector: ".bb-spoiler", format: "spoiler" },
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

export { bbCodeText } from "./bbcode/mask";
export { MAX_BODY_LENGTH };
