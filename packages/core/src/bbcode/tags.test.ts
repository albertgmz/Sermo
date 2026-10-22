import { describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { ValidationError } from "../errors";
import { MAX_MEDIA_EMBEDS } from "../limits";
import { excerptFromMarkdown, maskMarkupForExcerpt } from "../modules/seo/excerpt";
import { renderBbCode, renderContent, renderPlainText } from "../render";

const md = renderBbCode;

describe("BB code tags", () => {
  test("text styles", () => {
    expect(md("[B]bold[/B] [I]italic[/I] [U]underlined[/U] [S]struck-through[/S]")).toBe(
      "<p><strong>bold</strong> <em>italic</em> <u>underlined</u> <del>struck-through</del></p>",
    );
    expect(md("[b]a[/B] [Color=RED]x[/color]")).toBe(
      '<p><strong>a</strong> <span style="color:red">x</span></p>',
    );
  });

  test("COLOR takes named colours and hex, nothing else", () => {
    expect(md("[COLOR=red]red[/COLOR]")).toContain('style="color:red"');
    expect(md("[COLOR=#0000cc]blue[/COLOR]")).toContain('style="color:#0000cc"');
    expect(md("[COLOR=#abc]x[/COLOR]")).toContain('style="color:#abc"');
    for (const bad of [
      "#12",
      "#12345g",
      "red;background:url(x)",
      "expression(1)",
      "url(x)",
      "var(--x)",
      "notacolor",
    ])
      expect(md(`[COLOR=${bad}]x[/COLOR]`)).toBe(`<p>[COLOR=${bad}]x[/COLOR]</p>`);
  });

  test("FONT takes an allowlist as classes and SIZE 1 to 7", () => {
    expect(md("[FONT=Courier New]x[/FONT]")).toBe(
      '<p><span class="bb-font-courier-new">x</span></p>',
    );
    expect(md('[FONT="times new roman"]x[/FONT]')).toContain("bb-font-times-new-roman");
    expect(md("[FONT=Evil;x]x[/FONT]")).toBe("<p>[FONT=Evil;x]x[/FONT]</p>");
    expect(md('[FONT=Arial"onmouseover=1]x[/FONT]')).not.toContain("<span");
    expect(md("[SIZE=1]small[/SIZE] [SIZE=7]big[/SIZE]")).toBe(
      '<p><span class="bb-size-1">small</span> <span class="bb-size-7">big</span></p>',
    );
    for (const bad of ["0", "8", "12px", "x"])
      expect(md(`[SIZE=${bad}]x[/SIZE]`)).toBe(`<p>[SIZE=${bad}]x[/SIZE]</p>`);
  });

  test("links keep the rel attribute and only http, https and mailto", () => {
    const html = md(
      "[URL]https://www.example.com[/URL] [URL=https://www.example.com]Go to example.com[/URL] " +
        "[EMAIL]example@example.com[/EMAIL] [EMAIL=example@example.com]Email me[/EMAIL]",
    );
    expect(html).toContain(
      '<a href="https://www.example.com" rel="nofollow ugc noopener">https://www.example.com</a>',
    );
    expect(html).toContain('rel="nofollow ugc noopener">Go to example.com</a>');
    expect(html).toContain(
      '<a href="mailto:example@example.com" rel="nofollow ugc noopener">example@example.com</a>',
    );
    expect(html).toContain('rel="nofollow ugc noopener">Email me</a>');
    expect(md('[URL="https://a.example/x"]q[/URL]')).toContain('href="https://a.example/x"');
    expect(md("[URL=https://a.example][B]bold[/B] link[/URL]")).toContain(
      "<strong>bold</strong> link</a>",
    );
  });

  test("a link to a page of the site takes a path from the root", () => {
    expect(md("[URL=/contact]contact[/URL]")).toBe(
      '<p><a href="/contact" rel="nofollow ugc noopener">contact</a></p>',
    );
    expect(md("[URL=/members/3?tab=posts]x[/URL]")).toContain('href="/members/3?tab=posts"');
    for (const bad of ["//evil.example", "/\\evil.example", "contact", "./x", "/a b"])
      expect(md(`[URL=${bad}]x[/URL]`)).not.toContain("<a ");
  });

  test("unsafe link and image addresses stay text", () => {
    for (const source of [
      "[URL=javascript:alert(1)]x[/URL]",
      "[URL]javascript:alert(1)[/URL]",
      "[URL=JaVaScRiPt:alert(1)]x[/URL]",
      "[URL=data:text/html,<script>alert(1)</script>]x[/URL]",
      "[URL=//evil.example]x[/URL]",
      '[URL=https://a.example/" onclick="alert(1)]x[/URL]',
      "[EMAIL]javascript:alert(1)[/EMAIL]",
      '[EMAIL=a@b.c" onclick="x]x[/EMAIL]',
      "[IMG]javascript:alert(1)[/IMG]",
      "[IMG]data:image/svg+xml,<svg onload=alert(1)>[/IMG]",
      "[IMG]//evil.example/x.png[/IMG]",
      '[IMG]https://a.example/x.png" onerror="alert(1)[/IMG]',
    ]) {
      const html = md(source);
      // Markdown's own autolinking may link a bare address in the leftover text, never the tag's.
      expect(html).not.toMatch(/<a [^>]*(?:javascript|data:|onclick|evil)/i);
      expect(html).not.toMatch(/<img/);
      expect(html).not.toMatch(/<[^>]* onw+=/);
    }
  });

  test("IMG renders an image element", () => {
    expect(md("[IMG]https://xenforo.com/logo.png[/IMG]")).toBe(
      '<p><img src="https://xenforo.com/logo.png" alt="" /></p>',
    );
  });

  test("USER is plain text without a member context and a mention with one", async () => {
    expect(md("[USER=252865]Username[/USER]")).toBe("<p>Username</p>");
    const ctx = createTestContext();
    const author = userActor(insertUser(ctx));
    const member = insertUser(ctx, { username: "Alice" });
    const result = renderContent(
      ctx,
      author,
      `Hi [USER=${member.id}]whatever[/USER] and [USER=999999]Ghost[/USER]`,
    );
    expect(result.html).toContain(
      `<a href="/members/${member.id}" class="mention" data-user-id="${member.id}" rel="nofollow ugc noopener">@Alice</a>`,
    );
    expect(result.html).toContain("and Ghost");
    expect(result.mentionedUserIds).toEqual([member.id]);
    // Inside a link and inside code it is not a mention.
    const blocked = renderContent(
      ctx,
      author,
      `[URL=https://a.example][USER=${member.id}]A[/USER][/URL] [CODE=rich][USER=${member.id}]B[/USER][/CODE]`,
    );
    expect(blocked.mentionedUserIds).toEqual([]);
    expect(blocked.html).not.toContain("mention");
  });

  test("USER counts against the mention limit like @mentions", () => {
    const ctx = createTestContext();
    const authorUser = insertUser(ctx);
    ctx.sqlite.prepare("UPDATE users SET created_at = 0 WHERE id = ?1").run(authorUser.id);
    const members = Array.from({ length: 12 }, (_, i) =>
      insertUser(ctx, { username: `Member${i}` }),
    );
    const source = members.map((member) => `[USER=${member.id}]x[/USER]`).join(" ");
    const result = renderContent(ctx, userActor(authorUser), source);
    expect(result.mentionedUserIds).toHaveLength(10);
    expect(result.html.match(/class="mention"/g)).toHaveLength(10);
  });

  test("LIST and LIST=1", () => {
    expect(md("[LIST]\n[*]Bullet 1\n[*]Bullet 2\n[/LIST]")).toBe(
      "<ul><li>Bullet 1</li><li>Bullet 2</li></ul>",
    );
    expect(md("[LIST=1]\n[*]Entry 1\n[*]Entry 2\n[/LIST]")).toBe(
      "<ol><li>Entry 1</li><li>Entry 2</li></ol>",
    );
    expect(md("[LIST]\n[*]one\n[LIST=1]\n[*]a\n[*]b\n[/LIST]\n[*]two\n[/LIST]")).toBe(
      "<ul><li>one<ol><li>a</li><li>b</li></ol></li><li>two</li></ul>",
    );
    expect(md("[LIST=a][*]x[/LIST]")).toBe("<p>[LIST=a][*]x[/LIST]</p>");
    expect(md("[LIST]\n[*][B]bold[/B] and [I]it[/I]\n[/LIST]")).toContain(
      "<li><strong>bold</strong> and <em>it</em></li>",
    );
    // Text before the first [*] is an item of its own, blank text is dropped.
    expect(md("[LIST]first[*]second[/LIST]")).toBe("<ul><li>first</li><li>second</li></ul>");
    expect(md("[LIST]\n  \n[*]only[/LIST]")).toBe("<ul><li>only</li></ul>");
    // A [*] outside a list, or inside another tag of the list, is text.
    expect(md("[*]stray")).toBe("<p>[*]stray</p>");
    expect(md("[LIST][*][QUOTE][*]x[/QUOTE][/LIST]")).toContain("[*]x");
    // A tag open across two items closes at the second [*] and stays text.
    expect(md("[LIST][*][B]a[*]b[/B][/LIST]")).toBe("<ul><li>[B]a</li><li>b[/B]</li></ul>");
  });

  test("alignment, indentation and headings are blocks, also several on one line", () => {
    expect(
      md("[LEFT]Left-aligned[/LEFT] [CENTER]Center-aligned[/CENTER] [RIGHT]Right-aligned[/RIGHT]"),
    ).toBe(
      '<div class="bb-left">Left-aligned</div><div class="bb-center">Center-aligned</div><div class="bb-right">Right-aligned</div>',
    );
    expect(
      md("Regular text\n[INDENT]Indented text[/INDENT]\n[INDENT=2]More indented[/INDENT]"),
    ).toBe(
      '<p>Regular text</p><div class="bb-indent bb-indent-1">Indented text</div><div class="bb-indent bb-indent-2">More indented</div>',
    );
    expect(md("[INDENT=1][INDENT=2]deep[/INDENT][/INDENT]")).toBe(
      '<div class="bb-indent bb-indent-1"><div class="bb-indent bb-indent-2">deep</div></div>',
    );
    expect(md("[INDENT=6]x[/INDENT]")).toBe("<p>[INDENT=6]x[/INDENT]</p>");
    expect(
      md(
        "[HEADING=1]Major heading[/HEADING]\n[HEADING=2]Minor heading[/HEADING]\n[HEADING=3]Subheading[/HEADING]",
      ),
    ).toBe("<h1>Major heading</h1><h2>Minor heading</h2><h3>Subheading</h3>");
    expect(md("[HEADING=4]x[/HEADING]")).toBe("<p>[HEADING=4]x[/HEADING]</p>");
    expect(md("before [CENTER]mid[/CENTER] after")).toBe(
      '<p>before</p><div class="bb-center">mid</div><p>after</p>',
    );
  });

  test("Markdown typed in a message stays literal text", () => {
    const typed = "# Title\n\n- one\n- **two** _x_ `code` [a](https://b.example)\n> quote";
    const html = md(typed);
    expect(html).not.toMatch(/<(h1|ul|li|strong|em|blockquote)/);
    expect(html).toContain("# Title");
    expect(html).toContain("- **two** _x_ `code`");
    expect(html).toContain("&gt; quote");
    expect(md("```\n[B]fenced[/B]\n```")).toContain("<strong>fenced</strong>");
    expect(md("[CENTER]\n# Title\n\n- one\n[/CENTER]")).toBe(
      '<div class="bb-center"><p># Title</p><p>- one</p></div>',
    );
  });

  test("tags inside block tags and block tags inside inline tags", () => {
    expect(md("[CENTER]a [B]bold[/B][/CENTER]")).toBe(
      '<div class="bb-center">a <strong>bold</strong></div>',
    );
    expect(md("[B]a[QUOTE]q[/QUOTE]b[/B]")).toBe(
      '<strong>a<blockquote class="bb-quote">q</blockquote>b</strong>',
    );
  });

  test("line breaks are <br>, blank lines start a paragraph", () => {
    expect(md("a\nb\n\n\nc  \n \nd")).toBe("<p>a<br />b</p><p>c</p><p>d</p>");
    expect(md("[B]a\n\nb[/B]")).toBe("<p><strong>a<br /><br />b</strong></p>");
    expect(md("[QUOTE]a\n\nb[/QUOTE]")).toContain("<p>a</p><p>b</p>");
    expect(md("\n\n  \n")).toBe("");
  });

  test("bare addresses become links, nothing else is recognised", () => {
    const html = md("see https://a.example/x?y=1, (http://b.example/p_(q)) and www.c.example.");
    expect(html).toContain('<a href="https://a.example/x?y=1" rel="nofollow ugc noopener">');
    expect(html).toContain('href="http://b.example/p_(q)"');
    expect(html).toContain(
      '<a href="https://www.c.example" rel="nofollow ugc noopener">www.c.example</a>.',
    );
    expect(md("javascript:alert(1) ftp://x.example data:text/html,x")).not.toContain("<a ");
    expect(md("xhttps://a.example")).not.toContain("<a ");
    expect(md("https://")).not.toContain("<a ");
    // Not inside code or plain, and not inside a link.
    expect(md("[CODE]https://a.example[/CODE] [PLAIN]https://a.example[/PLAIN]")).not.toContain(
      "<a ",
    );
    expect(md("[URL=https://x.example]https://a.example[/URL]").match(/<a /g)).toHaveLength(1);
  });

  test("an option named rich changes nothing outside CODE and ICODE", () => {
    for (const tag of ["QUOTE", "SPOILER"]) {
      const html = md(`[${tag}=Rich][LIST][*]a[/LIST] https://a.example[/${tag}]`);
      expect(html).toContain("<ul><li>a</li></ul>");
      expect(html).toContain('<a href="https://a.example"');
    }
  });

  test("QUOTE keeps the author as data, not as words", () => {
    expect(md("[QUOTE]Quoted text[/QUOTE]")).toBe(
      '<blockquote class="bb-quote">Quoted text</blockquote>',
    );
    expect(md("[QUOTE=A person]Something they said[/QUOTE]")).toBe(
      '<blockquote class="bb-quote"><cite class="bb-quote-author">A person</cite>Something they said</blockquote>',
    );
    expect(md('[QUOTE="Alice, post: 12, member: 3"]x[/QUOTE]')).toContain(
      '<cite class="bb-quote-author">Alice</cite>',
    );
    const html = md('[QUOTE=<img src=x onerror=alert(1)>"x]y[/QUOTE]');
    expect(html).not.toContain("<img");
    expect(md("[QUOTE=Bob]a\n\nb[/QUOTE]")).toContain("<p>a</p>");
    expect(html).not.toContain("wrote");
    expect(md("[QUOTE=A]x[/QUOTE]")).not.toMatch(/said|wrote/);
  });

  test("tables", () => {
    expect(
      md(
        "[TABLE]\n[TR]\n[TH]Header 1[/TH]\n[TH]Header 2[/TH]\n[/TR]\n[TR]\n[TD]Content 1[/TD]\n[TD]Content 2[/TD]\n[/TR]\n[/TABLE]",
      ),
    ).toBe(
      '<table class="bb-table"><tbody><tr><th>Header 1</th><th>Header 2</th></tr><tr><td>Content 1</td><td>Content 2</td></tr></tbody></table>',
    );
    expect(md("[TABLE][TR][TD][I]md[/I] [B]bb[/B][/TD][/TR][/TABLE]")).toContain(
      "<td><em>md</em> <strong>bb</strong></td>",
    );
    expect(md("[TABLE]just text[/TABLE]")).toBe("<p>[TABLE]just text[/TABLE]</p>");
    // Cells outside a row are text; text between cells is dropped.
    expect(md("[TD]x[/TD]")).toBe("<p>[TD]x[/TD]</p>");
    expect(md("[TABLE][TR]stray[TD]a[/TD]more[/TR][/TABLE]")).toBe(
      '<p>straymore</p><table class="bb-table"><tbody><tr><td>a</td></tr></tbody></table>',
    );
  });

  test("a table, row or cell that is not closed leaves all its text", () => {
    for (const source of [
      "[TABLE][TR][TD]secret text[/TD]",
      "[TABLE][TR][TD]a[/TD][/TR]",
      "[TABLE][TR][TD]a[/TD][/TABLE]",
      "[TABLE][TR][TD]a[/TD][TD]b[/TD][/TR]",
      "[TR][TD]a[/TD][/TR][/TABLE]",
    ]) {
      const html = md(source);
      expect(html, source).not.toMatch(/<table|<td|<tr/);
      expect(html.replace(/<\/?p>/g, ""), source).toBe(source);
    }
  });

  test("text of a cell that is not closed is shown, not dropped", () => {
    const html = md("[TABLE][TR][TD]a[/TR][/TABLE]");
    expect(html).toContain("[TD]a");
  });

  test("PLAIN is literal, also across blank lines", () => {
    expect(md("[PLAIN]This is not [B]bold[/B] text.[/PLAIN]")).toBe(
      "<p>This is not [B]bold[/B] text.</p>",
    );
    expect(md("[PLAIN]*a* <b>x</b>\n\n[B]b[/B][/PLAIN]")).toBe(
      '<div class="bb-plain">*a* &lt;b&gt;x&lt;/b&gt;<br /><br />[B]b[/B]</div>',
    );
  });

  test("ATTACH renders a neutral placeholder", () => {
    expect(md("Thumbnail: [ATTACH]123[/ATTACH]")).toBe(
      '<p>Thumbnail: <span class="bb-attach" data-attach-id="123" data-attach-size="thumb">123</span></p>',
    );
    expect(md("[ATTACH=full]123[/ATTACH]")).toContain(
      'data-attach-id="123" data-attach-size="full">123</span>',
    );
    for (const bad of [
      "[ATTACH]abc[/ATTACH]",
      "[ATTACH]0[/ATTACH]",
      "[ATTACH=huge]1[/ATTACH]",
      "[ATTACH]1 2[/ATTACH]",
    ])
      expect(md(bad)).not.toContain("bb-attach");
  });

  test("ATTACH and IMG take XenForo's attributes: the type, a width and the alt text", () => {
    expect(md('[ATTACH type="full" width="300px" alt="Mapa <de> Cuba"]123[/ATTACH]')).toBe(
      '<p><span class="bb-attach" data-attach-id="123" data-attach-size="full" data-attach-width="300px" data-attach-alt="Mapa &lt;de&gt; Cuba">123</span></p>',
    );
    expect(md('[attach width="50%"]7[/attach]')).toBe(
      '<p><span class="bb-attach" data-attach-id="7" data-attach-size="thumb" data-attach-width="50%">7</span></p>',
    );
    expect(md('[IMG width="200px" alt="Mapa"]https://a.test/x.png[/IMG]')).toBe(
      '<p><img src="https://a.test/x.png" alt="Mapa" style="width:200px" /></p>',
    );
    // A width XenForo would not take is left out; the picture stays.
    for (const width of ["300", "0px", "300px;color:red", "12345px", "101%", "calc(1px)"]) {
      expect(md(`[ATTACH type="full" width="${width}"]1[/ATTACH]`)).toBe(
        '<p><span class="bb-attach" data-attach-id="1" data-attach-size="full">1</span></p>',
      );
    }
    for (const bad of [
      '[ATTACH type="huge"]1[/ATTACH]',
      "[ATTACH type=full]1[/ATTACH]",
      '[ATTACH=full width="1px"]1[/ATTACH]',
      '[ATTACH type="full"width="1px"]1[/ATTACH]',
    ])
      expect(md(bad)).not.toContain("bb-attach");
    expect(md('[B width="1px"]x[/B]')).toBe('<p>[B width="1px"]x[/B]</p>');
  });

  test("unknown, malformed and unclosed tags stay text", () => {
    for (const source of [
      "[unknown]x[/unknown]",
      "[B]never closed",
      "[/B] stray close",
      "[B=1]x[/B]",
      "[LIST]",
      "[QUOTE]no end",
      "[CODE]no end",
      "[ B ]x[/ B ]",
      "[URL=]x[/URL]",
    ])
      expect(md(source)).toBe(`<p>${source}</p>`);
    expect(md("[1] and [x] and [note]")).toBe("<p>[1] and [x] and [note]</p>");
  });
});

describe("BB code code", () => {
  test("CODE keeps the content literal and labels nothing in English", () => {
    const html = md("[CODE]General\n[B]code[/B] *x* <b>\n\nmore[/CODE]");
    expect(html).toBe(
      '<div class="bb-code"><div class="bb-code-header"></div><pre><code>General\n[B]code[/B] *x* &lt;b&gt;\n\nmore</code></pre></div>',
    );
    expect(html).not.toMatch(/Code:|Rich/);
  });

  test("CODE=rich renders BB tags but not Markdown", () => {
    expect(
      md("[CODE=rich][COLOR=red]Rich[/COLOR]\ncode *x* [URL=https://a.example]l[/URL][/CODE]"),
    ).toBe(
      '<div class="bb-code"><div class="bb-code-header bb-code-rich"></div><pre><code><span style="color:red">Rich</span>\ncode *x* <a href="https://a.example" rel="nofollow ugc noopener">l</a></code></pre></div>',
    );
    expect(md("[CODE=rich][B]a[/B] [CODE]x[/CODE][/CODE]")).toContain("<strong>a</strong>");
  });

  test("CODE=language highlights on the server and names the language", () => {
    const php = md("[CODE=php]echo $hello . ' world';[/CODE]");
    expect(php).toContain('<span class="bb-code-lang">PHP</span>');
    expect(php).toContain('<pre class="hljs language-php">');
    expect(php).toContain('<span class="hljs-keyword">echo</span>');
    const js = md("[CODE=javascript]var hello = 'world';[/CODE]");
    expect(js).toContain('<span class="bb-code-lang">JavaScript</span>');
    expect(js).toContain('<span class="hljs-keyword">var</span>');
    expect(md("[CODE=JS]let a = 1;[/CODE]")).toContain("JavaScript");
    expect(md("[CODE=html]<p>x</p>[/CODE]")).toContain('<span class="bb-code-lang">HTML</span>');
    for (const language of [
      "php",
      "javascript",
      "typescript",
      "python",
      "css",
      "xml",
      "sql",
      "json",
      "bash",
      "c",
      "cpp",
      "csharp",
      "java",
      "go",
      "rust",
      "ruby",
      "kotlin",
      "swift",
      "yaml",
      "markdown",
      "diff",
    ])
      expect(md(`[CODE=${language}]x[/CODE]`)).toContain(`language-${language}`);
  });

  test("an unknown language is a plain block with its name", () => {
    expect(md("[CODE=klingon]<b>qapla</b>[/CODE]")).toBe(
      '<div class="bb-code"><div class="bb-code-header bb-code-named"><span class="bb-code-lang">klingon</span></div><pre><code>&lt;b&gt;qapla&lt;/b&gt;</code></pre></div>',
    );
    expect(md('[CODE="><script>alert(1)</script>]x[/CODE]')).not.toContain("<script");
  });

  test("code with a very long line is not highlighted", () => {
    const line = "0_".repeat(995);
    const started = performance.now();
    const html = md(`[CODE=java]${line}[/CODE]`);
    expect(performance.now() - started).toBeLessThan(40);
    expect(html).not.toContain("hljs");
    expect(html).toContain(line);
    expect(md(`[CODE=java]${"int a = 1;\n".repeat(100)}[/CODE]`)).toContain("hljs");
  });

  test("highlighted output holds only hljs classes and escaped text", () => {
    const html = md('[CODE=javascript]var a = "</pre><script>alert(1)</script>";[/CODE]');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("</pre><script");
    expect(html.match(/class="([^"]*)"/g)!.every((c) => /bb-|hljs|language-/.test(c))).toBe(true);
  });

  test("ICODE", () => {
    expect(
      md(
        "Inline code sections [ICODE]are a [B]convenient[/B] way[/ICODE] of displaying code inline.",
      ),
    ).toBe(
      "<p>Inline code sections <code>are a [B]convenient[/B] way</code> of displaying code inline.</p>",
    );
    expect(
      md("Rich formatting [ICODE=rich]is [COLOR=red]also[/COLOR] [U]supported[/U] *x*[/ICODE]."),
    ).toBe(
      '<p>Rich formatting <code>is <span style="color:red">also</span> <u>supported</u> *x*</code>.</p>',
    );
  });

  test("a closing tag inside code does not end an enclosing tag", () => {
    expect(md("[QUOTE][CODE][/QUOTE][/CODE]still quoted[/QUOTE]")).toEndWith(
      "still quoted</p></blockquote>",
    );
  });
});

describe("BB code media", () => {
  test("YouTube builds the player address from the validated id", () => {
    const html = md("[MEDIA=youtube]kQ0Eo1UccEE[/MEDIA]");
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/kQ0Eo1UccEE"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain(
      'sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"',
    );
    expect(html).toContain('allow="fullscreen; picture-in-picture"');
    expect(md("[MEDIA=YOUTUBE]kQ0Eo1UccEE[/MEDIA]")).toContain("<iframe");
  });

  test("providers with a plain player render iframes, the others a link", () => {
    const iframes: [string, string, string][] = [
      ["vimeo", "76979871", "https://player.vimeo.com/video/76979871"],
      ["dailymotion", "x7tgad0", "https://www.dailymotion.com/embed/video/x7tgad0"],
      [
        "spotify",
        "track:4uLU6hMCjMI75M1A2tKUQC",
        "https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC",
      ],
      [
        "soundcloud",
        "forss/flickermood",
        "https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fforss%2Fflickermood",
      ],
      [
        "applemusic",
        "us/album/some-title/123456",
        "https://embed.music.apple.com/us/album/some-title/123456",
      ],
      ["giphy", "xT9IgzoKnwFNmISR8I", "https://giphy.com/embed/xT9IgzoKnwFNmISR8I"],
      ["tiktok", "6718335390845095173", "https://www.tiktok.com/embed/v2/6718335390845095173"],
    ];
    for (const [site, id, src] of iframes) {
      const html = md(`[MEDIA=${site}]${id}[/MEDIA]`);
      expect(html).toContain(`<iframe class="bb-media`);
      expect(html).toContain(`src="${src}"`);
    }
    const links: [string, string, string][] = [
      [
        "bluesky",
        "alice.bsky.social/3kabcdefghij",
        "https://bsky.app/profile/alice.bsky.social/post/3kabcdefghij",
      ],
      ["caniuse", "flexbox", "https://caniuse.com/flexbox"],
      ["facebook", "someone/posts/1234567", "https://www.facebook.com/someone/posts/1234567"],
      ["flickr", "49950210591", "https://www.flickr.com/photo.gne?id=49950210591"],
      ["imgur", "a/AbCd123", "https://imgur.com/a/AbCd123"],
      ["instagram", "CxyzAbc12_-", "https://www.instagram.com/p/CxyzAbc12_-/"],
      ["pinterest", "99360735500167749", "https://www.pinterest.com/pin/99360735500167749/"],
      ["reddit", "r/test/comments/abc123", "https://www.reddit.com/r/test/comments/abc123"],
      ["tumblr", "staff/180163456789", "https://staff.tumblr.com/post/180163456789"],
      ["twitch", "somechannel", "https://www.twitch.tv/somechannel"],
      ["twitter", "1234567890123", "https://x.com/i/status/1234567890123"],
      ["x", "1234567890123", "https://x.com/i/status/1234567890123"],
    ];
    for (const [site, id, url] of links) {
      const html = md(`[MEDIA=${site}]${id}[/MEDIA]`);
      expect(html).toContain(`<a class="bb-media-link bb-media-${site}" href="${url}"`);
      expect(html).not.toContain("<iframe");
    }
  });

  test("an invalid id or site leaves the tag as text", () => {
    for (const source of [
      "[MEDIA=youtube]short[/MEDIA]",
      '[MEDIA=youtube]kQ0Eo1UccE"[/MEDIA]',
      "[MEDIA=youtube]https://evil.example/x[/MEDIA]",
      "[MEDIA=youtube]../../evil.example/[/MEDIA]",
      "[MEDIA=vimeo]12a[/MEDIA]",
      "[MEDIA=spotify]track:short[/MEDIA]",
      "[MEDIA=soundcloud]a/b/../../x[/MEDIA]",
      "[MEDIA=reddit]r/x/comments/../..[/MEDIA]",
      "[MEDIA=unknownsite]abc[/MEDIA]",
      "[MEDIA=__proto__]abc[/MEDIA]",
      "[MEDIA=constructor]abc[/MEDIA]",
      "[MEDIA]kQ0Eo1UccEE[/MEDIA]",
    ]) {
      const html = md(source);
      expect(html).not.toMatch(/<iframe|bb-media-link/);
      expect(html).toContain("[MEDIA");
    }
  });
});

describe("BB code spoilers", () => {
  const ctx = createTestContext();
  const author = userActor(insertUser(ctx));

  test("without an actor they stay in the HTML, closed", () => {
    const html = md(
      "[SPOILER]Simple spoiler[/SPOILER]\n[SPOILER=Spoiler Title]With a title[/SPOILER]\nclick [ISPOILER]word[/ISPOILER]",
    );
    expect(html).toContain(
      '<details class="spoiler"><summary class="bb-spoiler-summary"></summary>Simple spoiler</details>',
    );
    expect(html).toContain(
      '<summary class="bb-spoiler-summary bb-has-title">Spoiler Title</summary>',
    );
    expect(html).toContain('<span class="spoiler">word</span>');
  });

  test("with an actor they leave the body, keeping position and title", () => {
    const result = renderContent(
      ctx,
      author,
      '[SPOILER]Simple spoiler[/SPOILER]\n[SPOILER=Spoiler Title]Titled [B]bb[/B][/SPOILER]\nclick [ISPOILER]word[/ISPOILER] and [ISPOILER]inline[/ISPOILER]\n\n[SPOILER="Old"]first\n\nsecond[/SPOILER]',
    );
    expect(result.html).not.toMatch(/Simple spoiler|Titled|>word|first|second/);
    expect(result.html).toContain('<div class="bb-spoiler" data-spoiler="0"></div>');
    expect(result.html).toContain(
      '<div class="bb-spoiler" data-spoiler="1" data-spoiler-title="Spoiler Title"></div>',
    );
    expect(result.html).toContain(
      '<span class="bb-spoiler bb-spoiler-inline" data-spoiler="2"></span>',
    );
    expect(result.html).toContain(
      '<span class="bb-spoiler bb-spoiler-inline" data-spoiler="3"></span>',
    );
    expect(result.html).toContain(
      '<div class="bb-spoiler" data-spoiler="4" data-spoiler-title="Old"></div>',
    );
    expect(result.spoilers).toEqual([
      "Simple spoiler",
      "Titled <strong>bb</strong>",
      "word",
      "inline",
      "<p>first</p><p>second</p>",
    ]);
  });

  test("a spoiler inside another is a placeholder in the outer one's HTML", () => {
    const result = renderContent(
      ctx,
      author,
      "[SPOILER]outer [ISPOILER]inner[/ISPOILER]\n\n[SPOILER=T]deepest[/SPOILER][/SPOILER] after [ISPOILER]md[/ISPOILER]",
    );
    expect(result.spoilers).toHaveLength(4);
    expect(result.spoilers[0]).toContain('data-spoiler="1"');
    expect(result.spoilers[0]).toContain('data-spoiler="2"');
    expect(result.spoilers[0]).not.toMatch(/inner|deepest/);
    expect(result.spoilers[1]).toBe("inner");
    expect(result.spoilers[2]).toBe("deepest");
    expect(result.spoilers[3]).toBe("md");
    expect(result.html).not.toMatch(/outer|inner|deepest/);
  });

  test("spoiler HTML is sanitized", () => {
    const result = renderContent(
      ctx,
      author,
      "[SPOILER]<script>alert(1)</script> [URL=javascript:x]a[/URL] <img src=x onerror=alert(1)>[/SPOILER]",
    );
    expect(result.spoilers[0]).not.toMatch(/<script|<img|href="javascript|<a /);
    expect(result.spoilers[0]).toContain("&lt;script&gt;");
  });

  test("plain text of rendered content shows [spoiler]", () => {
    const result = renderContent(
      ctx,
      author,
      "pre [SPOILER=Title]secret[/SPOILER] mid [ISPOILER]hidden[/ISPOILER] post",
    );
    const text = renderPlainText(result.html);
    expect(text).toContain("pre");
    expect(text).toContain("post");
    expect(text.match(/\[spoiler\]/g)).toHaveLength(2);
    expect(text).not.toMatch(/secret|hidden|Title/);
    expect(
      renderPlainText(md("[SPOILER]x secret[/SPOILER] [ISPOILER]y secret[/ISPOILER]")),
    ).not.toContain("secret");
  });

  test("excerpts and search text mask every spoiler form", () => {
    const source =
      "keep1 [SPOILER=Title]secret one[/SPOILER] keep2 [ispoiler]secret two[/ispoiler] keep3 " +
      "[SPOILER]a [SPOILER]b[/SPOILER] secret three[/SPOILER] keep4 [SPOILER][CODE][/SPOILER][/CODE]secret four[/SPOILER] keep5";
    for (const text of [excerptFromMarkdown(source, 1000), maskMarkupForExcerpt(source)]) {
      expect(text).not.toContain("secret");
      expect(text).not.toContain("[SPOILER");
      for (const word of ["keep1", "keep2", "keep3", "keep4", "keep5"])
        expect(text).toContain(word);
      expect(text).toContain("[spoiler]");
    }
    const plain = excerptFromMarkdown(
      "[B]bold[/B] [URL=https://a.example]link[/URL] [QUOTE=Al]q[/QUOTE]",
    );
    expect(plain).toBe("bold link q");
    // Content the renderer leaves visible is not hidden.
    expect(excerptFromMarkdown("[SPOILER]never closed visible")).toContain("never closed visible");
  });
});

describe("BB code limits", () => {
  test("quotes and spoilers nest at most ten deep", () => {
    const nest = (tag: string, depth: number) =>
      `${`[${tag}]`.repeat(depth)}x${`[/${tag}]`.repeat(depth)}`;
    for (const tag of ["QUOTE", "SPOILER"]) {
      expect(md(nest(tag, 10))).toContain("x");
      expect(() => md(nest(tag, 11))).toThrow(ValidationError);
    }
    expect(() => md(nest("ISPOILER", 11))).toThrow(ValidationError);
  });

  test("a spoiler or quote is also counted through other tags", () => {
    const wrapped = (depth: number) =>
      `${"[QUOTE][LEFT]".repeat(depth)}x${"[/LEFT][/QUOTE]".repeat(depth)}`;
    expect(md(wrapped(10))).toContain("x");
    expect(() => md(wrapped(11))).toThrow(ValidationError);
    expect(() => md(`${"[B]".repeat(200)}x${"[/B]".repeat(200)}`)).toThrow(ValidationError);
  });

  test("adversarial 10,000 character inputs finish quickly with a result or a ValidationError", () => {
    const tags = [
      "B",
      "QUOTE",
      "SPOILER",
      "CODE",
      "LIST",
      "TABLE",
      "URL=https://a.example",
      "MEDIA=youtube",
      "PLAIN",
      "COLOR=red",
      "CENTER",
    ];
    const inputs: string[] = [];
    for (const tag of tags) {
      const open = `[${tag}]`;
      const close = `[/${tag.split("=")[0]}]`;
      inputs.push(open.repeat(Math.floor(10_000 / open.length)));
      inputs.push(close.repeat(Math.floor(10_000 / close.length)));
      inputs.push((open + close).repeat(Math.floor(10_000 / (open.length + close.length))));
      inputs.push(open.repeat(1000).slice(0, 5000) + close.repeat(1000).slice(0, 5000));
      inputs.push(`${open}x\n\n`.repeat(Math.floor(10_000 / (open.length + 3))));
    }
    inputs.push(
      "[".repeat(10_000),
      "[*]".repeat(3333),
      "[TR][TD]".repeat(1250),
      "[B]".repeat(3333) + "[/QUOTE]".repeat(1000),
    );
    inputs.push(`[SPOILER]${"[SPOILER]".repeat(1000)}`.slice(0, 10_000));
    inputs.push(`[CODE=php]${"<?php echo 1; ".repeat(700)}[/CODE]`);
    inputs.push(`[CODE=rich]${"[B]".repeat(3000)}[/CODE]`);
    const ctx = createTestContext();
    const actor = userActor(insertUser(ctx));
    for (const input of inputs) {
      const started = performance.now();
      try {
        renderContent(ctx, actor, input);
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
      }
      expect(performance.now() - started).toBeLessThan(2500);
    }
  }, 30_000);
});

describe("BB code review limits", () => {
  test("code over 2,000 characters is a plain block, shorter code is highlighted", () => {
    const line = "public static void main(String[] args) { int a = 1; }\n";
    const long = line.repeat(Math.floor(9_900 / line.length));
    expect(long.length).toBeGreaterThan(9_800);
    const plain = md(`[CODE=java]${long}[/CODE]`);
    expect(plain).not.toContain("hljs");
    expect(plain).toContain('<span class="bb-code-lang">java</span>');
    expect(plain).toContain("public static void main");
    const short = md(`[CODE=java]${line.repeat(30)}[/CODE]`);
    expect(short).toContain("hljs-keyword");
    expect(short).toContain('<span class="bb-code-lang">Java</span>');
  });

  test("no link inside a link, and a spoiler inside one stays a spoiler", () => {
    const ctx = createTestContext();
    const actor = userActor(insertUser(ctx));
    const nested = md(
      "[URL=https://a.example]see [URL=https://b.example]inner[/URL] and [EMAIL]x@y.example[/EMAIL][/URL]",
    );
    expect(nested.match(/<a /g)).toHaveLength(1);
    expect(nested).toContain("see inner and x@y.example</a>");
    const bare = md("[URL=https://a.example]see https://b.example here[/URL]");
    expect(bare.match(/<a /g)).toHaveLength(1);
    expect(bare).toContain("see https://b.example here</a>");
    expect(
      md("[EMAIL=a@b.example]mail [URL=https://c.example]c[/URL][/EMAIL]").match(/<a /g),
    ).toHaveLength(1);
    // A spoiler in a link stays a spoiler: its text is never in the body.
    for (const source of [
      "[URL=https://a.example]go [ISPOILER]SECRET[/ISPOILER][/URL]",
      "[EMAIL=a@b.example]go [ISPOILER]SECRET[/ISPOILER][/EMAIL]",
    ]) {
      const spoiler = renderContent(ctx, actor, source);
      expect(spoiler.html).not.toContain("SECRET");
      expect(spoiler.html).toContain('data-spoiler="0"');
      expect(spoiler.spoilers).toEqual(["SECRET"]);
    }
    // Without an actor the spoiler is a closed inline one, still a spoiler.
    expect(md("[URL=https://a.example]go [ISPOILER]x[/ISPOILER][/URL]")).toContain(
      'class="spoiler"',
    );
    // Outside a link both still work.
    expect(renderContent(ctx, actor, "[ISPOILER]s[/ISPOILER]").spoilers).toEqual(["s"]);
  });

  test("a player link inside a link is only named, players past the limit are links", () => {
    const inLink = md("[URL=http://a.b][MEDIA=twitter]1[/MEDIA] text[/URL]");
    expect(inLink.match(/<a /g)).toHaveLength(1);
    expect(inLink).toContain("https://x.com/i/status/1 text</a>");
    // A player inside a link is fine.
    expect(md("[URL=http://a.b][MEDIA=youtube]kQ0Eo1UccEE[/MEDIA][/URL]")).toContain("<iframe");
    const many = md("[MEDIA=vimeo]1[/MEDIA]".repeat(60));
    expect(many.match(/<iframe/g)).toHaveLength(MAX_MEDIA_EMBEDS);
    expect(
      many.match(/<a class="bb-media-link bb-media-vimeo" href="https:\/\/vimeo.com\/1"/g),
    ).toHaveLength(60 - MAX_MEDIA_EMBEDS);
    expect(
      md("[MEDIA=reddit]r/test/comments/abc123[/MEDIA]".repeat(60)).match(/<a /g),
    ).toHaveLength(60);
  });

  test("an unclosed rich code tag is text and changes nothing after it", () => {
    for (const open of ["[CODE=rich]", "[ICODE=rich]"]) {
      const html = md(`${open} hello\n[QUOTE]q[/QUOTE]\n[LIST][*]a[/LIST] https://a.example`);
      expect(html).toContain("<blockquote");
      expect(html).toContain("<ul><li>a</li></ul>");
      expect(html).toContain('<a href="https://a.example"');
    }
    // A tag that closes over it leaves it text too, and what it had skipped is drawn.
    const crossed = md("[B][CODE=rich]x\n[QUOTE]q[/QUOTE][/B][/CODE]");
    expect(crossed).toContain("<blockquote");
    expect(crossed).toContain("[CODE=rich]");
    // Closed, it still turns them into text.
    expect(md("[CODE=rich][QUOTE]q[/QUOTE][/CODE]")).not.toContain("<blockquote");
  });

  test("addresses are found whatever their case, and may hold an apostrophe", () => {
    expect(md("Http://a.b/c")).toContain('<a href="Http://a.b/c"');
    const mixed = md("HTTP://A.B/C and http://x.y");
    expect(mixed.match(/<a /g)).toHaveLength(2);
    expect(md("WWW.a.b")).toContain('<a href="https://WWW.a.b"');
    expect(md("see https://en.wikipedia.org/wiki/Alice's_Adventures.")).toContain(
      'href="https://en.wikipedia.org/wiki/Alice\'s_Adventures"',
    );
    expect(md("[URL=https://a.example/it's]x[/URL]")).toContain('href="https://a.example/it\'s"');
    expect(md("[URL=http://a.b/\u0000x]x[/URL]")).not.toContain('href="http://a.b/\u0000');
  });

  test("a link option may be 2,000 characters, other options 200", () => {
    const long = `https://example.com/${"a".repeat(1_900)}`;
    expect(md(`[URL=${long}]x[/URL]`)).toContain(`href="${long}"`);
    expect(md(`[URL=${long}${"a".repeat(200)}]x[/URL]`)).toContain("]x[/URL]");
    expect(md(`[QUOTE=${"a".repeat(201)}]x[/QUOTE]`)).not.toContain("<blockquote");
    expect(md(`[URL=${long}[b]x[/b][/URL]`)).toContain("<strong>x</strong>[/URL]");
  });

  test("[URL]www.example.com[/URL] links like a bare address", () => {
    expect(md("[URL]www.example.com[/URL]")).toBe(
      '<p><a href="https://www.example.com" rel="nofollow ugc noopener">www.example.com</a></p>',
    );
    expect(md("[URL]example.com[/URL]")).toBe("<p>[URL]example.com[/URL]</p>");
    const brackets = md("[URL]http://a.b/[b]x[/b][/URL]");
    expect(brackets).toContain("[URL]");
    expect(brackets).not.toContain('href="http://a.b/[');
  });

  test("a line holding only a no-break space still ends a paragraph", () => {
    expect(md("a\n \nb")).toBe("<p>a</p><p>b</p>");
  });

  test("EMAIL takes plain addresses only", () => {
    expect(md("[EMAIL]first.last+tag@mail.example.com[/EMAIL]")).toContain(
      'href="mailto:first.last+tag@mail.example.com"',
    );
    // The tag stays text (Markdown may still link a bare address in it, never with a query).
    for (const bad of [
      "a@b.example?subject=x",
      "a@b.example&cc=c@d.example",
      "a b@c.example",
      "a@b",
      "a@b.example#x",
    ])
      expect(md(`[EMAIL]${bad}[/EMAIL]`)).toContain("[EMAIL]");
    expect(md("[EMAIL=a@b.example?bcc=x@y.example]m[/EMAIL]")).toContain("[EMAIL=");
  });
});

describe("BB code as XenForo writes it", () => {
  test("a single-quoted option reads like a double-quoted one", () => {
    expect(md("[URL='https://a.example/x']link[/URL]")).toBe(
      '<p><a href="https://a.example/x" rel="nofollow ugc noopener">link</a></p>',
    );
    expect(md("[FONT='Arial']x[/FONT]")).toBe('<p><span class="bb-font-arial">x</span></p>');
    expect(md("[EMAIL='a@b.example']mail[/EMAIL]")).toBe(
      '<p><a href="mailto:a@b.example" rel="nofollow ugc noopener">mail</a></p>',
    );
    expect(md("[SPOILER='Ending']secret[/SPOILER]")).toContain("Ending");
    expect(md("[QUOTE='Alice']x[/QUOTE]")).toBe(
      '<blockquote class="bb-quote"><cite class="bb-quote-author">Alice</cite>x</blockquote>',
    );
    // An apostrophe or a double quote inside the name does not end it; only ' followed by ].
    expect(md("[QUOTE='O'Brien']x[/QUOTE]")).toContain("bb-quote-author\">O'Brien<");
    expect(md(`[QUOTE='Say "hi"']x[/QUOTE]`)).toContain('Say "hi"</cite>');
    // Not closed: still text.
    expect(md("[QUOTE='Alice]x[/QUOTE]")).toBe("<p>[QUOTE='Alice]x[/QUOTE]</p>");
    expect(md("[URL='https://a.example]x[/URL]")).toContain("[URL='");
  });

  test("JUSTIFY is a block drawn as left-aligned text", () => {
    expect(md("[JUSTIFY]Some [B]long[/B] text[/JUSTIFY]")).toBe(
      '<div class="bb-left">Some <strong>long</strong> text</div>',
    );
    expect(md("before [JUSTIFY]mid[/JUSTIFY] after")).toBe(
      '<p>before</p><div class="bb-left">mid</div><p>after</p>',
    );
    expect(md("[justify]a[/justify]")).toBe('<div class="bb-left">a</div>');
    expect(md("[JUSTIFY=2]x[/JUSTIFY]")).toBe("<p>[JUSTIFY=2]x[/JUSTIFY]</p>");
    expect(md("[JUSTIFY]open")).toBe("<p>[JUSTIFY]open</p>");
  });

  test("a stray [/HR] is swallowed", () => {
    expect(md("a\n[HR][/HR]\nb")).toBe("<p>a</p><hr /><p>b</p>");
    expect(md("[HR][/HR]")).toBe("<hr />");
    expect(md("a [/HR] b")).toBe("<p>a  b</p>");
    expect(md("[B]x[/HR]y[/B]")).toBe("<p><strong>xy</strong></p>");
    // The text on both sides joins as if the tag were absent.
    expect(md("a\n[/HR]\nb")).toBe(md("a\n\nb"));
    expect(md("https://a.example/x[/HR]y")).toBe(md("https://a.example/xy"));
    expect(md("#tag[/HR]more")).toBe(md("#tagmore"));
    // Literal tags keep it as typed.
    expect(md("[CODE][HR][/HR][/CODE]")).toContain("[HR][/HR]");
    expect(md("[CODE=rich][/HR][/CODE]")).toContain("[/HR]");
    expect(maskMarkupForExcerpt("a[HR][/HR]b")).toBe("ab");
  });

  test("a quote option may end in any key: N pairs", () => {
    const cite = (option: string) => md(`[QUOTE=${option}]x[/QUOTE]`);
    expect(cite('"Alice, convMessage: 123, member: 4"')).toBe(
      '<blockquote class="bb-quote"><cite class="bb-quote-author">Alice</cite>x</blockquote>',
    );
    expect(cite('"Alice, convMessage: 123"')).toContain(">Alice<");
    expect(cite("'Alice, convMessage: 123, member: 4'")).toContain(">Alice<");
    expect(cite('"Alice, post: 12, member: 3"')).toContain(">Alice<");
    expect(cite('"Alice, other: 1, post: 12, member: 3, more: 9"')).toContain(">Alice<");
    // Only a trailing run of pairs is metadata; a colon in the name is still the name.
    expect(cite('"Re: Bob, convMessage: 5"')).toContain(">Re: Bob<");
    expect(cite('"Bob, level: high"')).toContain(">Bob, level: high<");
    expect(cite('"Bob, post: 12, Alice"')).toContain(">Bob, post: 12, Alice<");
    // A lone pair is a name unless its key is one XenForo writes.
    expect(cite('"Agent: 47"')).toContain(">Agent: 47<");
    expect(cite("Chapter: 3")).toContain(">Chapter: 3<");
    expect(cite('"Agent: 47, convMessage: 5"')).toContain(">Agent: 47<");
    expect(cite('"member: 4"')).toBe('<blockquote class="bb-quote">x</blockquote>');
    // No author left.
    expect(cite('"convMessage: 123"')).toBe('<blockquote class="bb-quote">x</blockquote>');
  });

  test("a quoted name may hold brackets and double quotes, ending at a quote that closes the tag", () => {
    const cite = (option: string) => md(`[QUOTE=${option}]x[/QUOTE]`);
    const author = (html: string) => /<cite class="bb-quote-author">(.*?)<\/cite>/.exec(html)?.[1];
    expect(author(cite('"Aoki [x], post: 1, member: 2"'))).toBe("Aoki [x]");
    expect(author(cite('"Crow[de(a)d]"'))).toBe("Crow[de(a)d]");
    expect(author(cite('"a]b"'))).toBe("a]b");
    expect(author(cite('"Say "hi""'))).toBe('Say "hi"');
    expect(author(cite('"a"b, post: 3"'))).toBe('a"b');
    // The tag is still one tag, and what follows it is read as before.
    expect(md('[QUOTE="Aoki [x]"][B]b[/B][/QUOTE] [I]c[/I]')).toContain("<strong>b</strong>");
    // Only a QUOTE reads that far; other tags and other forms of the option are as they were.
    expect(md('[COLOR="red] [B]b[/B] "x"]y[/COLOR]')).toContain("<strong>b</strong>");
    // Never closed, or closed on another line: text.
    expect(md('[QUOTE="Aoki [x]]x[/QUOTE]')).toBe('<p>[QUOTE="Aoki [x]]x[/QUOTE]</p>');
    expect(md('[QUOTE="Aoki\n[x]"]x[/QUOTE]')).toStartWith('<p>[QUOTE="Aoki');
  });
});
