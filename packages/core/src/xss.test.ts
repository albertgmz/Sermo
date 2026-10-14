import { describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import sanitizeHtml from "sanitize-html";
import { conversationsCreateOp, conversationsReplyOp } from "./modules/conversations";
import { nodesCreateOp, postsCreateOp, postsUpdateOp, threadsCreateOp } from "./modules/forums";
import {
  profileCommentsCreateOp,
  profileCommentsUpdateOp,
  profilePostsCreateOp,
  profilePostsUpdateOp,
} from "./modules/profiles";
import { execute } from "./operation";

const payloads = [
  ["script element", "<script>alert(1)</script>"],
  ["image event handler", "<img src=x onerror=alert(1)>"],
  ["SVG event handler", "<svg onload=alert(1)>x</svg>"],
  ["raw JavaScript link", '<a href="javascript:alert(1)">x</a>'],
  ["Markdown JavaScript link", "[x](javascript:alert(1))"],
  ["mixed-case JavaScript scheme", "[x](JaVaScRiPt:alert(1))"],
  ["entity-encoded JavaScript scheme", "[x](&#106;avascript:alert(1))"],
  ["data URL", "[x](data:text/html,<script>alert(1)</script>)"],
  ["Markdown JavaScript image", "![x](javascript:alert(1))"],
  ["iframe", '<iframe src="https://evil.example/"></iframe>'],
  ["object", '<object data="https://evil.example/"></object>'],
  ["embed", '<embed src="https://evil.example/">'],
  ["style element", "<style>body{background:red}</style>"],
  ["style attribute", '<a href="https://a.b" style="color:red">x</a>'],
  ["link event handler", '<a href="https://a.b" onclick="alert(1)">x</a>'],
  ["nested script opening", "<scr<script>ipt>alert(1)</script>"],
  ["doubled script opening", "<<script>script>alert(1)</script>"],
  ["unclosed tag", "<script>alert(1)"],
  ["misnested tags", "<b><i>x</b></i>"],
  ["link title attribute breakout", '[x](https://a.b "\\" onmouseover=\\"alert(1)")'],
  ["HTML comment", "<!-- <script>alert(1)</script> -->"],
  ["CDATA", "<![CDATA[<script>alert(1)</script>]]>"],
  ["meta refresh", '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">'],
  ["JavaScript form", '<form action="javascript:alert(1)"><button>x</button></form>'],
  ["protocol-relative link", "[x](//evil.example/path)"],
  ["protocol-relative image", "![x](//evil.example/pixel.png)"],
  [
    "Markdown mixed with raw HTML",
    "**safe** <img src=x onerror=alert(1)> [x](javascript:alert(1))",
  ],
  ["VBScript URL", "[x](vbscript:msgbox(1))"],
  ["image data URL", "![x](data:image/svg+xml,<svg onload=alert(1)>)"],
  ["spoiler title HTML", ':::spoiler{title="<img src=x onerror=alert(1)>"}\nsecret\n:::'],
  ["spoiler title JavaScript URL", ':::spoiler{title="javascript:alert(1)"}\nsecret\n:::'],
  ["inline spoiler HTML", ">!<svg onload=alert(1)>!<"],
  ["mention inside link", "[@Nobody](javascript:alert(1))"],
  ["BB URL JavaScript", "[URL=javascript:alert(1)]x[/URL]"],
  ["BB URL entity-encoded scheme", "[URL=&#106;avascript:alert(1)]x[/URL]"],
  ["BB URL without option", "[URL]javascript:alert(1)[/URL]"],
  ["BB URL attribute breakout", '[URL=https://a.b" onmouseover="alert(1)]x[/URL]'],
  ["BB IMG JavaScript", "[IMG]javascript:alert(1)[/IMG]"],
  ["BB IMG data URL", "[IMG]data:image/svg+xml,<svg onload=alert(1)>[/IMG]"],
  ["BB IMG attribute breakout", '[IMG]https://a.b/x.png" onerror="alert(1)[/IMG]'],
  ["BB EMAIL JavaScript", "[EMAIL=javascript:alert(1)//a@b.co]x[/EMAIL]"],
  ["BB EMAIL attribute breakout", '[EMAIL=a@b.co" onclick="alert(1)]x[/EMAIL]'],
  ["BB COLOR style injection", "[COLOR=red;background:url(javascript:alert(1))]x[/COLOR]"],
  ["BB COLOR expression", "[COLOR=expression(alert(1))]x[/COLOR]"],
  ["BB COLOR attribute breakout", '[COLOR=red" onmouseover="alert(1)]x[/COLOR]'],
  ["BB FONT style injection", "[FONT=Arial;position:fixed;inset:0]x[/FONT]"],
  ["BB FONT attribute breakout", '[FONT=Arial" onmouseover="alert(1)]x[/FONT]'],
  ["BB SIZE injection", '[SIZE=7" onmouseover="alert(1)]x[/SIZE]'],
  ["BB MEDIA attribute breakout", '[MEDIA=youtube]kQ0Eo1UccE" onload="alert(1)[/MEDIA]'],
  ["BB MEDIA foreign host", "[MEDIA=youtube]https://evil.example/embed/x[/MEDIA]"],
  ["BB MEDIA path traversal", "[MEDIA=soundcloud]a/../../../evil[/MEDIA]"],
  ["BB MEDIA unknown site", "[MEDIA=evil]kQ0Eo1UccEE[/MEDIA]"],
  ["BB QUOTE name HTML", '[QUOTE="><img src=x onerror=alert(1)>]x[/QUOTE]'],
  ["BB SPOILER title HTML", '[SPOILER="><img src=x onerror=alert(1)>]x[/SPOILER]'],
  ["BB SPOILER title attribute breakout", '[SPOILER=a" onclick="alert(1)]x[/SPOILER]'],
  ["BB CODE language HTML", '[CODE="><img src=x onerror=alert(1)>]x[/CODE]'],
  ["BB CODE content HTML", "[CODE=php]<script>alert(1)</script>[/CODE]"],
  ["BB rich code JavaScript link", "[CODE=rich][URL=javascript:alert(1)]x[/URL][/CODE]"],
  ["BB ICODE rich HTML", "[ICODE=rich]<img src=x onerror=alert(1)>[/ICODE]"],
  ["BB USER attribute breakout", '[USER=1" onclick="alert(1)]x[/USER]'],
  ["BB ATTACH attribute breakout", '[ATTACH]1" onclick="alert(1)[/ATTACH]'],
  ["BB PLAIN HTML", "[PLAIN]<script>alert(1)</script>[/PLAIN]"],
  [
    "BB HTML in tag content",
    "[B]<img src=x onerror=alert(1)>[/B] [LEFT]<svg onload=alert(1)>[/LEFT]",
  ],
  ["BB table HTML", "[TABLE][TR][TD]<img src=x onerror=alert(1)>[/TD][/TR][/TABLE]"],
  ["BB list HTML", "[LIST][*]<script>alert(1)</script>[/LIST]"],
  [
    "BB spoiler holding payloads",
    "[SPOILER][URL=javascript:alert(1)]x[/URL] <img src=x onerror=alert(1)>[/SPOILER]",
  ],
] as const;

const forbiddenTags = new Set([
  "script",
  "iframe",
  "object",
  "embed",
  "style",
  "form",
  "meta",
  "svg",
]);

function expectSafeHtml(html: string): void {
  // onOpenTag sees the parsed stored HTML before sanitize-html applies its own filtering.
  sanitizeHtml(html, {
    allowedTags: [],
    allowedAttributes: {},
    onOpenTag(name, attributes) {
      expect(forbiddenTags.has(name)).toBe(false);
      for (const [attribute, value] of Object.entries(attributes)) {
        expect(attribute.startsWith("on")).toBe(false);
        expect(attribute).not.toBe("style");
        if (attribute === "href" || attribute === "src") {
          expect(value.startsWith("//")).toBe(false);
          if (attribute === "href" && /^\/(?:members|posts)\/\d+$/.test(value)) continue;
          let protocol: string;
          try {
            protocol = new URL(value).protocol;
          } catch {
            throw new Error(`Invalid ${attribute} URL in stored HTML: ${value}`);
          }
          expect(
            attribute === "src" ? ["http:", "https:"] : ["http:", "https:", "mailto:"],
          ).toContain(protocol);
        }
      }
      if (name === "a") expect(attributes.rel).toBe("nofollow ugc noopener");
    },
  });
}

function storedHtml(
  ctx: ReturnType<typeof createTestContext>,
  table: string,
  column: string,
  id: number,
): string {
  const row = ctx.sqlite
    .prepare<{ body_html: string }, [number]>(`SELECT body_html FROM ${table} WHERE ${column} = ?1`)
    .get(id);
  expect(row).toBeDefined();
  return row!.body_html;
}

describe("stored content HTML rejects XSS", () => {
  for (const [label, payload] of payloads) {
    test(`post create and update: ${label}`, async () => {
      const ctx = createTestContext();
      const admin = userActor(insertUser(ctx, { groupId: 4 }));
      const author = userActor(insertUser(ctx));
      const forum = await execute(ctx, nodesCreateOp, admin, {
        parentId: null,
        type: "forum",
        title: "Forum",
      });
      const thread = await execute(ctx, threadsCreateOp, author, {
        nodeId: forum.id,
        title: "Thread",
        body: "Initial post",
      });
      const post = await execute(ctx, postsCreateOp, author, {
        threadId: thread.thread.id,
        body: payload,
      });
      const read = () => storedHtml(ctx, "post_bodies", "post_id", post.id);
      expectSafeHtml(read());
      await execute(ctx, postsUpdateOp, author, { postId: post.id, body: "**replacement**" });
      expect(read()).toContain("<strong>replacement</strong>");
      await execute(ctx, postsUpdateOp, author, { postId: post.id, body: payload });
      expect(read()).not.toContain("replacement");
      expectSafeHtml(read());
    });

    test(`profile post create and update: ${label}`, async () => {
      const ctx = createTestContext();
      const author = userActor(insertUser(ctx));
      const wall = insertUser(ctx);
      const post = await execute(ctx, profilePostsCreateOp, author, {
        userId: wall.id,
        body: payload,
      });
      const read = () => storedHtml(ctx, "profile_posts", "id", post.id);
      expectSafeHtml(read());
      await execute(ctx, profilePostsUpdateOp, author, {
        profilePostId: post.id,
        body: "**replacement**",
      });
      expect(read()).toContain("<strong>replacement</strong>");
      await execute(ctx, profilePostsUpdateOp, author, { profilePostId: post.id, body: payload });
      expect(read()).not.toContain("replacement");
      expectSafeHtml(read());
    });

    test(`profile comment create and update: ${label}`, async () => {
      const ctx = createTestContext();
      const author = userActor(insertUser(ctx));
      const wall = insertUser(ctx);
      const post = await execute(ctx, profilePostsCreateOp, author, {
        userId: wall.id,
        body: "Wall post",
      });
      const comment = await execute(ctx, profileCommentsCreateOp, author, {
        profilePostId: post.id,
        body: payload,
      });
      const read = () => storedHtml(ctx, "profile_post_comments", "id", comment.id);
      expectSafeHtml(read());
      await execute(ctx, profileCommentsUpdateOp, author, {
        commentId: comment.id,
        body: "**replacement**",
      });
      expect(read()).toContain("<strong>replacement</strong>");
      await execute(ctx, profileCommentsUpdateOp, author, { commentId: comment.id, body: payload });
      expect(read()).not.toContain("replacement");
      expectSafeHtml(read());
    });

    test(`conversation create and reply: ${label}`, async () => {
      const ctx = createTestContext();
      const author = userActor(insertUser(ctx));
      const recipient = insertUser(ctx);
      const made = await execute(ctx, conversationsCreateOp, author, {
        title: "Private",
        recipientIds: [recipient.id],
        body: payload,
      });
      expectSafeHtml(storedHtml(ctx, "conversation_messages", "id", made.message.id));
      const reply = await execute(ctx, conversationsReplyOp, author, {
        conversationId: made.conversation.id,
        body: payload,
      });
      expectSafeHtml(storedHtml(ctx, "conversation_messages", "id", reply.id));
    });
  }

  test("harmless Markdown remains formatted in all four stored content types", async () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const author = userActor(insertUser(ctx));
    const recipient = insertUser(ctx);
    const body = "**bold** [link](https://example.com)\n\n- one\n- two";
    const forum = await execute(ctx, nodesCreateOp, admin, {
      parentId: null,
      type: "forum",
      title: "Forum",
    });
    const thread = await execute(ctx, threadsCreateOp, author, {
      nodeId: forum.id,
      title: "Thread",
      body: "Initial post",
    });
    const post = await execute(ctx, postsCreateOp, author, { threadId: thread.thread.id, body });
    const wallPost = await execute(ctx, profilePostsCreateOp, author, {
      userId: recipient.id,
      body,
    });
    const comment = await execute(ctx, profileCommentsCreateOp, author, {
      profilePostId: wallPost.id,
      body,
    });
    const conversation = await execute(ctx, conversationsCreateOp, author, {
      title: "Private",
      recipientIds: [recipient.id],
      body,
    });
    for (const html of [
      storedHtml(ctx, "post_bodies", "post_id", post.id),
      storedHtml(ctx, "profile_posts", "id", wallPost.id),
      storedHtml(ctx, "profile_post_comments", "id", comment.id),
      storedHtml(ctx, "conversation_messages", "id", conversation.message.id),
    ]) {
      expectSafeHtml(html);
      expect(html).toContain("<strong>bold</strong>");
      expect(html).toContain('<a href="https://example.com" rel="nofollow ugc noopener">link</a>');
      expect(html).toContain("<li>one</li>");
      expect(html).toContain("<li>two</li>");
    }
  });

  test("valid BB code output carries only the whitelisted style values and embed hosts", async () => {
    const ctx = createTestContext();
    const author = userActor(insertUser(ctx));
    const wall = insertUser(ctx);
    const post = await execute(ctx, profilePostsCreateOp, author, {
      userId: wall.id,
      body:
        "[COLOR=red]a[/COLOR] [COLOR=#0000CC]b[/COLOR] [MEDIA=youtube]kQ0Eo1UccEE[/MEDIA] " +
        "[MEDIA=soundcloud]forss/flickermood[/MEDIA] [MEDIA=reddit]r/test/comments/abc123[/MEDIA]",
    });
    const html = storedHtml(ctx, "profile_posts", "id", post.id);
    const styles = [...html.matchAll(/ style="([^"]*)"/g)].map((match) => match[1]);
    expect(styles).toEqual(["color:red", "color:#0000cc"]);
    const sources = [...html.matchAll(/<iframe[^>]* src="([^"]*)"/g)].map((match) => match[1]);
    expect(sources.map((source) => new URL(source!).hostname)).toEqual([
      "www.youtube-nocookie.com",
      "w.soundcloud.com",
    ]);
    expect(html.match(/<iframe/g)).toHaveLength(2);
    expect(html).toContain('href="https://www.reddit.com/r/test/comments/abc123"');
  });

  test("the HTML held back in spoilers is as safe as the body", async () => {
    const ctx = createTestContext();
    const author = userActor(insertUser(ctx));
    const wall = insertUser(ctx);
    for (const [label, payload] of payloads) {
      const post = await execute(ctx, profilePostsCreateOp, author, {
        userId: wall.id,
        body: `[SPOILER]${payload}[/SPOILER] >!${payload}!<`,
      });
      expectSafeHtml(storedHtml(ctx, "profile_posts", "id", post.id));
      const spoilers = ctx.sqlite
        .prepare<{ html: string }, [number]>(
          "SELECT html FROM content_spoilers WHERE content_type = 'profile_post' AND content_id = ?1",
        )
        .all(post.id);
      expect(spoilers.length, label).toBeGreaterThan(0);
      for (const spoiler of spoilers) expectSafeHtml(spoiler.html);
    }
  });

  test("nested spoilers in quotes and forged directive attributes stay safe", async () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const author = userActor(insertUser(ctx, { username: "Alice" }));
    const reader = userActor(insertUser(ctx));
    const forum = await execute(ctx, nodesCreateOp, admin, {
      parentId: null,
      type: "forum",
      title: "Forum",
    });
    const quoted = await execute(ctx, threadsCreateOp, author, {
      nodeId: forum.id,
      title: "Source",
      body: "Original",
    });
    const payload = `:::quote{post=${quoted.post.id} author="<img src=x onerror=alert(1)>"}\n:::spoiler{title="<svg onload=alert(1)>"}\n[bad](javascript:alert(1))\n:::\n:::`;
    const post = await execute(ctx, postsCreateOp, reader, {
      threadId: quoted.thread.id,
      body: payload,
    });
    const html = storedHtml(ctx, "post_bodies", "post_id", post.id);
    expectSafeHtml(html);
    expect(html).toContain("Alice</a> wrote:");
    expect(html).not.toContain("onerror=");
  });
});
