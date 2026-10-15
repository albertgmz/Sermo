import { describe, expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { invalidate } from "../context";
import { fillThreads } from "../modules/feed/fixtures.test";
import { renderBbCode, renderContent, renderPlainText } from "../render";
import { Deadline } from "./deadline";
import { MAX_TAG_LENGTH, normalizeTag } from "./hashtag";
import { lex, pair } from "./scan";
import { build } from "./tree";

/** The hashtags the tree builder finds in a source, as their keys. */
function found(source: string): string[] {
  const deadline = new Deadline(Number.POSITIVE_INFINITY);
  const toks = lex(source, deadline);
  pair(toks, deadline);
  return build(source, toks, deadline).hashtags.map((tag) => tag.tag);
}

describe("which text is a hashtag", () => {
  test("a # and letters, numbers and underscores", () => {
    expect(found("#hello")).toEqual(["hello"]);
    expect(found("go #hello and #world_2 now")).toEqual(["hello", "world_2"]);
    expect(found("line one\n#second\n(#third) and, #fourth.")).toEqual([
      "second",
      "third",
      "fourth",
    ]);
    expect(found("[B]#bold[/B] [I]x #italic[/I]")).toEqual(["bold", "italic"]);
    expect(found("#tag-with-dash")).toEqual(["tag"]);
  });

  test("Spanish accents and other letters work", () => {
    expect(found("#canción #Ñandú #año2026 #über")).toEqual([
      "canción",
      "ñandú",
      "año2026",
      "über",
    ]);
    expect(found("#日本語")).toEqual(["日本語"]);
  });

  test("tags compare after NFC and lowercase", () => {
    expect(found("#Foo #FOO #foo")).toEqual(["foo", "foo", "foo"]);
    // e + combining acute is the same tag as the single letter é
    expect(found("#café")).toEqual(["café"]);
    expect(found("#CAFÉ")).toEqual(["café"]);
    expect(normalizeTag("#Café")).toBe("café");
    expect(normalizeTag("Foo_Bar")).toBe("foo_bar");
  });

  test("it needs a letter and at most 50 characters", () => {
    expect(found("#2024 #123 #_ #__1")).toEqual([]);
    expect(found("#a1 #1a")).toEqual(["a1", "1a"]);
    const longest = "x".repeat(MAX_TAG_LENGTH);
    expect(found(`#${longest}`)).toEqual([longest]);
    expect(found(`#${longest}y`)).toEqual([]);
    expect(normalizeTag(`${longest}y`)).toBeNull();
    expect(normalizeTag("")).toBeNull();
    expect(normalizeTag("two words")).toBeNull();
    expect(normalizeTag("#")).toBeNull();
  });

  test("not after a letter, a number, & or /", () => {
    expect(found("a#b")).toEqual([]);
    expect(found("x1#b")).toEqual([]);
    expect(found("&#123; and &#x41;")).toEqual([]);
    expect(found("see /path#section and docs/page#top")).toEqual([]);
    expect(found("é#b")).toEqual([]);
    // After a space, punctuation or the start of the text it is one.
    expect(found("(#a) [#b] ,#c")).toEqual(["a", "b", "c"]);
  });

  test("code, plain text, links, addresses and quote attributions hold none", () => {
    expect(found("[CODE]#a[/CODE]")).toEqual([]);
    expect(found("[CODE=js]var #a = 1[/CODE]")).toEqual([]);
    expect(found("[ICODE]#a[/ICODE]")).toEqual([]);
    expect(found("[PLAIN]#a[/PLAIN]")).toEqual([]);
    expect(found("[CODE=rich]#a [B]#b[/B][/CODE]")).toEqual([]);
    expect(found("[URL=https://example.com]#a[/URL]")).toEqual([]);
    expect(found("[URL=https://example.com][B]#a[/B][/URL]")).toEqual([]);
    expect(found("[URL]https://example.com/#a[/URL]")).toEqual([]);
    expect(found("[EMAIL]a@example.com[/EMAIL]")).toEqual([]);
    expect(found("https://example.com/page#frag and #real")).toEqual(["real"]);
    expect(found("www.example.com/#frag")).toEqual([]);
    expect(found('[QUOTE="#a, post: 4, member: 2"]quoted[/QUOTE]')).toEqual([]);
    expect(found("[QUOTE=#a]text #b[/QUOTE]")).toEqual(["b"]);
    expect(found("[USER=3]#a[/USER]")).toEqual([]);
  });

  test("a hashtag and a mention or an address sit side by side", () => {
    expect(found("@alice #tag https://example.com #other")).toEqual(["tag", "other"]);
  });
});

describe("rendering a hashtag", () => {
  const ctx = createTestContext();
  const user = insertUser(ctx);
  const actor = userActor(user);
  // Two tags in use in a forum the writer can open, and one used only in a forum nobody can.
  const open = insertNode(ctx, {});
  const closed = insertNode(ctx, {});
  ctx.sqlite
    .prepare("INSERT INTO node_permissions (node_id, group_id, can_view) VALUES (?1, 2, 0)")
    .run(closed.id);
  invalidate(ctx, "node_tree");
  invalidate(ctx, "permissions");
  ctx.sqlite
    .prepare(
      "INSERT INTO tags (name, created_at) VALUES ('café', ?1), ('hello', ?1), ('secret', ?1)",
    )
    .run(ctx.now());
  const use = (name: string, nodeId: number) => {
    const [thread] = fillThreads(ctx, nodeId, user.id, 1);
    ctx.sqlite
      .prepare(
        "INSERT INTO thread_tags (thread_id, tag_id, added_by, sort_at, vis, node_id, author_id, created_at) SELECT ?1, id, ?2, 1, 1, ?3, ?2, 1 FROM tags WHERE name = ?4",
      )
      .run(thread!, user.id, nodeId, name);
  };
  use("café", open.id);
  use("hello", open.id);
  use("secret", closed.id);
  const render = (source: string, hashtags = { create: false, slots: 0 }) =>
    renderContent(ctx, actor, source, { hashtags });

  test("without rules, or with no actor, it stays as typed", () => {
    expect(renderContent(ctx, actor, "#hello").html).toBe("<p>#hello</p>");
    expect(renderBbCode("#hello")).toBe("<p>#hello</p>");
  });

  test("a tag that exists links to its page, whatever the case or composition", () => {
    const html = render("Try #Hello and #CAFÉ!").html;
    expect(html).toBe(
      '<p>Try <a href="/tags/hello" class="hashtag" rel="nofollow ugc noopener">#Hello</a> and ' +
        '<a href="/tags/caf%C3%A9" class="hashtag" rel="nofollow ugc noopener">#CAFÉ</a>!</p>',
    );
  });

  test("an unknown tag stays text unless the rules let it be made", () => {
    expect(render("#nothing").html).toBe("<p>#nothing</p>");
    const made = render("#nothing", { create: true, slots: 3 });
    expect(made.html).toContain('href="/tags/nothing"');
    expect(made.hashtags).toEqual(["nothing"]);
    // Not with no slot left.
    const full = render("#hello #nothing", { create: true, slots: 1 });
    expect(full.html).toContain('href="/tags/hello"');
    expect(full.html).not.toContain("/tags/nothing");
    expect(full.hashtags).toEqual(["hello"]);
  });

  test("tags a text puts on its thread are distinct, in order, within the slots", () => {
    const result = render("#hello #Hello #new1 #new2 #hello #new3", { create: true, slots: 3 });
    expect(result.hashtags).toEqual(["hello", "new1", "new2"]);
    expect(result.html).not.toContain("/tags/new3");
    // A text that only links puts none, but known tags are links.
    const links = render("#hello #new1");
    expect(links.hashtags).toEqual([]);
    expect(links.html).toContain('href="/tags/hello"');
    expect(links.html).not.toContain('new1"');
  });

  test("a tag used only in forums the writer cannot open is no tag to them", () => {
    const hidden = render("#secret #hello");
    expect(hidden.html).toBe(
      '<p>#secret <a href="/tags/hello" class="hashtag" rel="nofollow ugc noopener">#hello</a></p>',
    );
    // A writer who may make tags gets the same answer for it as for a new name: a link, no more.
    const made = render("#secret #fresh", { create: true, slots: 5 });
    expect(made.html.match(/class="hashtag"/g)).toHaveLength(2);
  });

  test("a hashtag in a spoiler or a quote links where it is when the tag is known, and tags nothing", () => {
    const result = render(
      "#hello [SPOILER]#hello #fresh #café[/SPOILER] [QUOTE=bob]#fresh2 #café[/QUOTE]",
      { create: true, slots: 5 },
    );
    // Only the hashtag in the open is a thread tag.
    expect(result.hashtags).toEqual(["hello"]);
    const inside = result.spoilers.join("");
    expect(inside).toContain('href="/tags/hello"');
    expect(inside).toContain('href="/tags/caf%C3%A9"');
    expect(inside).not.toContain("/tags/fresh");
    expect(result.html).not.toContain("/tags/fresh2");
    expect(result.html).toContain('href="/tags/caf%C3%A9"');
    // Alone in a spoiler, a new name stays text and takes no slot.
    const alone = render("[SPOILER]#fresh[/SPOILER]", { create: true, slots: 5 });
    expect(alone.hashtags).toEqual([]);
    expect(alone.spoilers.join("")).not.toContain("/tags/");
  });

  test("code, links and spoilers: only text outside the skipped parts links", () => {
    const html = render("[CODE]#hello[/CODE] [URL=https://a.example]#hello[/URL] #hello").html;
    expect(html.match(/class="hashtag"/g)).toHaveLength(1);
    const spoiler = renderContent(ctx, actor, "[SPOILER]#hello[/SPOILER]", {
      hashtags: { create: false, slots: 0 },
    });
    expect(spoiler.spoilers.join("")).toContain('class="hashtag"');
  });

  test("one lookup serves the whole message", () => {
    let queries = 0;
    const prepare = ctx.sqlite.prepare.bind(ctx.sqlite);
    ctx.statements.clear();
    // biome-ignore lint/suspicious/noExplicitAny: the wrapper forwards whatever the statement takes
    (ctx.sqlite as any).prepare = (sql: string) => {
      if (sql.includes("tag_aliases")) queries++;
      return prepare(sql);
    };
    try {
      render("#a1 #a2 #a3 #a4 #a5 #hello #café");
    } finally {
      // biome-ignore lint/suspicious/noExplicitAny: restoring the original
      (ctx.sqlite as any).prepare = prepare;
      ctx.statements.clear();
    }
    expect(queries).toBe(1);
  });

  test("a plain-text reading drops the link markup", () => {
    expect(renderPlainText(render("Try #hello now").html)).toBe("Try #hello now");
  });

  test("a message full of hashtags stays within the time bound", () => {
    const source = `${"#tag ".repeat(1900)}`;
    const started = performance.now();
    renderContent(ctx, actor, source, { hashtags: { create: true, slots: 10 } });
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("look-alike names", () => {
  test("variation selectors and other characters that draw nothing are not part of a name", () => {
    expect(normalizeTag("a\uFE0F")).toBe("a");
    expect(normalizeTag("a\u{E0100}")).toBe("a");
    expect(normalizeTag("a\u034F")).toBe("a");
    expect(normalizeTag("a\u180B")).toBe("a");
    expect(normalizeTag("a\u200Db")).toBe("ab");
    expect(found("#a #a\uFE0F #A\uFE0F")).toEqual(["a", "a", "a"]);
  });

  test("a combining mark that composes is the letter, one that does not composes stays", () => {
    expect(normalizeTag("e\u0301")).toBe("\u00E9");
    expect(normalizeTag("e\u0301")).toBe(normalizeTag("\u00E9"));
    expect(normalizeTag("x\u0301")).toBe("x\u0301");
    expect(normalizeTag("a")).not.toBe(normalizeTag("a\u0301"));
  });
});

describe("what a name is", () => {
  test("a run of # is no hashtag", () => {
    expect(found("##x")).toEqual([]);
    expect(found("## Title and #real")).toEqual(["real"]);
    expect(found("###x ###")).toEqual([]);
  });

  test("a Greek final sigma is one spelling with the other", () => {
    expect(normalizeTag("ΑΣ")).toBe("ασ");
    expect(normalizeTag("ας")).toBe("ασ");
    expect(found("#ΑΣ #ασ #ας")).toEqual(["ασ", "ασ", "ασ"]);
  });

  test("a name needs a letter that draws something", () => {
    for (const filler of ["\u3164", "\u115F", "\u1160", "\uFFA0", "\u3164\u3164_1"])
      expect(normalizeTag(filler), JSON.stringify(filler)).toBeNull();
    expect(found("#\u3164 #\u115F\u1160")).toEqual([]);
    // Combining marks and digits do not make a name either; a real letter does.
    expect(normalizeTag("\u0301")).toBeNull();
    // A filler beside a real letter is dropped with the other characters that draw nothing.
    expect(normalizeTag("\u3164a")).toBe("a");
  });
});

describe("an attribute that looks like a hashtag is not one", () => {
  test("a tag with an option that is never closed keeps its colour as text", () => {
    expect(found("[COLOR=#ff0000]red text")).toEqual([]);
    expect(found("[URL=#frag]x[/URL]")).toEqual([]);
    expect(found("[FONT=#a]x")).toEqual([]);
    expect(found("[SIZE=#abc]x")).toEqual([]);
    expect(found("a=#b")).toEqual([]);
    // The same text with the tag closed is a colour, and a hashtag beside it is a hashtag.
    expect(found("[COLOR=#ff0000]red[/COLOR] #real")).toEqual(["real"]);
  });
});
