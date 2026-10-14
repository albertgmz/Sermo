import { describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { ValidationError } from "../errors";
import { excerptFromMarkdown, maskMarkupForExcerpt } from "../modules/seo/excerpt";
import { renderContent, renderMarkdown, renderPlainText } from "../render";

const md = renderMarkdown;

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
    expect(md("[URL=https://a.example]**bold** link[/URL]")).toContain(
      "<strong>bold</strong> link</a>",
    );
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

  test("IMG renders the same image element as Markdown", () => {
    expect(md("[IMG]https://xenforo.com/logo.png[/IMG]")).toBe(
      md("![](https://xenforo.com/logo.png)")
        .replace("<p><img", "<p><img")
        .replace(' alt=""', ' alt=""'),
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
    expect(md("[LIST]\n[*][B]bold[/B] and *md*\n[/LIST]")).toContain(
      "<li><strong>bold</strong> and <em>md</em></li>",
    );
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
      '<p>Regular text</p>\n<div class="bb-indent bb-indent-1">Indented text</div><div class="bb-indent bb-indent-2">More indented</div>',
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
      '<p>before </p>\n<div class="bb-center">mid</div><p> after</p>',
    );
  });

  test("Markdown renders inside block tags and BB code inside Markdown", () => {
    const html = md("[CENTER]\n# Title\n\n- one\n- **two**\n[/CENTER]");
    expect(html).toContain('<div class="bb-center"><h1>Title</h1>');
    expect(html).toContain("<li><strong>two</strong></li>");
    expect(md("- item [B]bold[/B]\n> [I]quoted[/I]")).toContain("<strong>bold</strong>");
    expect(md("> [I]quoted[/I]")).toContain("<blockquote>\n<p><em>quoted</em></p>");
    expect(md("`[B]code[/B]`")).toBe("<p><code>[B]code[/B]</code></p>");
    expect(md("```\n[B]fenced[/B]\n```")).toContain("[B]fenced[/B]");
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
    expect(md("[TABLE][TR][TD]**md** [B]bb[/B][/TD][/TR][/TABLE]")).toContain(
      "<td><strong>md</strong> <strong>bb</strong></td>",
    );
    expect(md("[TABLE]just text[/TABLE]")).toBe("<p>[TABLE]just text[/TABLE]</p>");
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
      "still quoted</p>\n</blockquote>",
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
      '[SPOILER]Simple spoiler[/SPOILER]\n[SPOILER=Spoiler Title]Titled **md**[/SPOILER]\nclick [ISPOILER]word[/ISPOILER] and >!inline!<\n\n:::spoiler{title="Old"}\nold style\n:::',
    );
    expect(result.html).not.toMatch(/Simple spoiler|Titled|word|inline!|old style/);
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
      "Titled <strong>md</strong>",
      "word",
      "inline",
      "<p>old style</p>",
    ]);
  });

  test("a spoiler inside another is a placeholder in the outer one's HTML", () => {
    const result = renderContent(
      ctx,
      author,
      "[SPOILER]outer [ISPOILER]inner[/ISPOILER]\n\n[SPOILER=T]deepest[/SPOILER][/SPOILER] after >!md!<",
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
    expect(result.spoilers[0]).not.toMatch(/<script|onerror=|<img|href="javascript/);
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

  test("more than 1000 spoilers are refused", () => {
    expect(() => renderContent(ctx, author, ">!a!< ".repeat(1001))).toThrow(ValidationError);
    expect(renderContent(ctx, author, ">!a!<\n\n".repeat(1000)).spoilers).toHaveLength(1000);
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
