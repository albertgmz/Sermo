import { describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
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
  const actor = userActor(insertUser(ctx));
  ctx.sqlite
    .prepare("INSERT INTO tags (name, created_at) VALUES ('café', ?1), ('hello', ?1)")
    .run(ctx.now());
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
