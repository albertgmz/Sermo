import { describe, expect, test } from "bun:test";
import { ForbiddenError, ValidationError } from "../../errors";
import { type World, world } from "../members/fixtures.test";

const sign = (w: World, signature: string | null, actor = w.moderatorActor) =>
  w.call("profiles.update", actor, { signature });
const settings = (w: World, changes: object) => w.call("settings.update", w.adminActor, changes);
const refusal = async (w: World, signature: string) => {
  const error = await sign(w, signature).then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ValidationError);
  return (error as ValidationError).message;
};

describe("signature limits, measured on the rendered html", () => {
  test("links: over and at the limit, Markdown and BB code count alike", async () => {
    const w = world();
    await settings(w, { signatureMaxLinks: 2 });
    await sign(w, "[a](https://a.test) [b](https://b.test)");
    expect(await refusal(w, "[a](https://a.test) [b](https://b.test) [c](https://c.test)")).toBe(
      "A signature may hold at most 2 links; this one has 3.",
    );
    expect(await refusal(w, "[a](https://a.test) [URL=https://b.test]b[/URL] https://c.test")).toBe(
      "A signature may hold at most 2 links; this one has 3.",
    );
    expect(
      await refusal(
        w,
        "[URL]https://a.test[/URL] [url=https://b.test]b[/url] [email]a@b.test[/email]",
      ),
    ).toContain("3");
  });

  test("0 and -1 mean no limit, as for the anti-spam counts", async () => {
    const w = world();
    const many = Array.from({ length: 8 }, (_, i) => `[l${i}](https://e${i}.test)`).join(" ");
    for (const value of [0, -1]) {
      await settings(w, {
        signatureMaxLinks: value,
        signatureMaxLength: 2000,
        signatureMaxLines: 20,
      });
      await sign(w, many);
    }
    await settings(w, { signatureMaxLinks: 7 });
    expect(await refusal(w, many)).toContain("at most 7 links");
  });

  test("pictures need their kind and then obey the count", async () => {
    const w = world();
    const one = "![x](https://i.test/a.png)";
    expect(await refusal(w, one)).toBe("A signature cannot use pictures.");
    expect(await refusal(w, "[IMG]https://i.test/a.png[/IMG]")).toBe(
      "A signature cannot use pictures.",
    );
    await settings(w, {
      signatureFormats: ["bold", "image"],
      signatureMaxImages: 2,
    });
    const profile = await sign(w, `${one} ![y](https://i.test/b.png)`);
    expect(profile.signatureHtml).toContain("<img");
    expect(await refusal(w, `${one} ${one} ${one}`)).toBe(
      "A signature may hold at most 2 pictures; this one has 3.",
    );
    await settings(w, { signatureMaxImages: 1 });
    expect(await refusal(w, `${one} ${one}`)).toBe(
      "A signature may hold at most 1 picture; this one has 2.",
    );
  });

  test("emoji count as smilies; symbols and plain text do not", async () => {
    const w = world();
    await settings(w, { signatureMaxSmilies: 3 });
    await sign(w, "(c) 2026 :) ™ \u{1F600}\u{1F44D}\u{1F1EA}\u{1F1F8}");
    expect(await refusal(w, "\u{1F600}\u{1F44D}\u{1F1EA}\u{1F1F8}❤️")).toBe(
      "A signature may hold at most 3 emoji; this one has 4.",
    );
    // A joined sequence and a skin tone are one emoji each.
    await sign(w, "\u{1F468}‍\u{1F469}‍\u{1F467} \u{1F44D}\u{1F3FD} ❤️");
    await settings(w, { signatureMaxSmilies: 0 });
    await sign(w, "\u{1F600}".repeat(10));
  });

  test("text size: the largest [size] and heading allowed", async () => {
    const w = world();
    await settings(w, { signatureFormats: ["size", "heading"], signatureMaxTextSize: 4 });
    await sign(w, "[SIZE=4]ok[/SIZE]");
    expect(await refusal(w, "[SIZE=5]big[/SIZE]")).toBe(
      "A signature's text may be at most size 4; this one uses size 5.",
    );
    // h4 is size 4, h3 is size 5.
    await sign(w, "#### small heading");
    expect(await refusal(w, "### larger heading")).toContain("uses size 5");
    expect(await refusal(w, "[HEADING=1]x[/HEADING]")).toContain("uses size 7");
    await settings(w, { signatureMaxTextSize: 0 });
    await sign(w, "[SIZE=7]huge[/SIZE]");
    await settings(w, { signatureMaxTextSize: 7 });
    await sign(w, "# top");
  });

  test("emoji and text size treat 0 and -1 alike", async () => {
    const w = world();
    await settings(w, { signatureFormats: ["size"] });
    for (const value of [0, -1]) {
      await settings(w, { signatureMaxSmilies: value, signatureMaxTextSize: value });
      await sign(w, "😀".repeat(30) + " [SIZE=7]big[/SIZE]");
    }
  });

  test("a signature that draws nothing, or several blocks, is refused", async () => {
    const w = world();
    expect(await refusal(w, "[a]: http://x.example")).toBe(
      "A signature must have something to show.",
    );
    await settings(w, { signatureFormats: ["heading", "align"], signatureMaxTextSize: 0 });
    expect(await refusal(w, "# a\n\n# b")).toStartWith("A signature is one short block");
    expect(await refusal(w, "[CENTER]a[/CENTER]\n\n[RIGHT]b[/RIGHT]")).toStartWith(
      "A signature is one short block",
    );
    await sign(w, "# one heading");
    await sign(w, "[CENTER]one block[/CENTER]");
  });

  test("length and lines still count the source", async () => {
    const w = world();
    await settings(w, { signatureMaxLength: 10, signatureMaxLines: 2 });
    await sign(w, "x".repeat(10));
    await expect(sign(w, "x".repeat(11))).rejects.toBeInstanceOf(ValidationError);
    await sign(w, "a\nb");
    await expect(sign(w, "a\nb\nc")).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("allowed formatting", () => {
  const cases: [string, string, string][] = [
    ["bold", "**x**", "bold text"],
    ["bold", "[B]x[/B]", "bold text"],
    ["italic", "*x*", "italic text"],
    ["underline", "[U]x[/U]", "underlined text"],
    ["strikethrough", "~~x~~", "strikethrough text"],
    ["code", "`x`", "inline code"],
    ["color", "[COLOR=red]x[/COLOR]", "coloured text"],
    ["font", "[FONT=Arial]x[/FONT]", "fonts"],
    ["size", "[SIZE=2]x[/SIZE]", "text sizes"],
    ["heading", "## x", "headings"],
    ["link", "[x](https://a.test)", "links"],
    ["image", "![x](https://i.test/a.png)", "pictures"],
    ["list", "- x\n- y", "lists"],
    ["align", "[CENTER]x[/CENTER]", "alignment"],
  ];

  test("each kind is refused unless listed, and accepted once it is", async () => {
    const w = world();
    // Nothing allowed at all: only plain text and line breaks.
    await settings(w, { signatureFormats: [], signatureMaxTextSize: 0, signatureMaxLinks: 0 });
    await sign(w, "plain text\nsecond line");
    for (const [kind, source, label] of cases) {
      expect(await refusal(w, source), `${kind}: ${source}`).toBe(
        `A signature cannot use ${label}.`,
      );
      await settings(w, { signatureFormats: [kind] });
      await sign(w, source);
      await settings(w, { signatureFormats: [] });
    }
  });

  test("a refusal names every kind that is not allowed", async () => {
    const w = world();
    await settings(w, { signatureFormats: ["bold"] });
    expect(await refusal(w, "**a** *b* [c](https://c.test)")).toBe(
      "A signature cannot use italic text, links.",
    );
  });

  test("a list of kinds is a set", async () => {
    const w = world();
    const saved = await settings(w, { signatureFormats: ["bold", "bold", "link"] });
    expect(saved.signatureFormats).toEqual(["bold", "link"]);
  });

  test("structure is never allowed, whatever the list says", async () => {
    const w = world();
    await settings(w, {
      signatureFormats: [
        "bold",
        "italic",
        "underline",
        "strikethrough",
        "code",
        "color",
        "font",
        "size",
        "heading",
        "link",
        "image",
        "list",
        "align",
      ],
      signatureMaxLength: 500,
      signatureMaxLines: 20,
    });
    for (const source of [
      "> quoted",
      "[QUOTE]x[/QUOTE]",
      "[SPOILER]x[/SPOILER]",
      "!<secret>!",
      ":::spoiler\nx\n:::",
      "```\ncode\n```",
      "[CODE]x[/CODE]",
      "| a | b |\n| - | - |\n| 1 | 2 |",
      "[TABLE][TR][TD]x[/TD][/TR][/TABLE]",
      "[INDENT]x[/INDENT]",
      "[MEDIA=youtube]dQw4w9WgXcQ[/MEDIA]",
      "---",
      "two\n\nparagraphs",
      "<b>raw html</b>",
    ]) {
      expect(await refusal(w, source), source).toStartWith("A signature is one short block");
    }
  });

  test("a signature stored before a kind was dropped is not touched until it is saved again", async () => {
    const w = world();
    await sign(w, "**kept**");
    await settings(w, { signatureFormats: ["italic"] });
    const profile = await w.call("profiles.get", w.memberActor, { userId: w.moderator.id });
    expect(profile.signatureHtml).toContain("<strong>kept</strong>");
    expect(await refusal(w, "**kept**")).toBe("A signature cannot use bold text.");
    expect((await sign(w, null)).signatureHtml).toBeNull();
  });

  test("the limits reach the member's own profile read", async () => {
    const w = world();
    await settings(w, { signatureMaxLinks: 1, signatureFormats: ["bold"] });
    const self = await w.call("profiles.self", w.moderatorActor, {});
    expect(self.limits).toMatchObject({
      signatureMaxLinks: 1,
      signatureMaxImages: 1,
      signatureMaxSmilies: 5,
      signatureMaxTextSize: 4,
      signatureFormats: ["bold"],
    });
    expect(self.signatureNeeds).toBeNull();
  });
});

describe("the signature rule", () => {
  const rule = { match: "all", conditions: [{ criterion: "post_count", value: 3 }] };

  test("setting one needs the rule on top of profile.signature; clearing never does", async () => {
    const w = world();
    await settings(w, { signatureRule: rule });
    w.set(w.moderator.id, { post_count: 2 });
    const error = await sign(w, "hello").then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ForbiddenError);
    expect((error as ForbiddenError).message).toMatch(
      /^You cannot set a signature yet\. You need .*3/,
    );
    const self = await w.call("profiles.self", w.moderatorActor, {});
    expect(self.may.setSignature).toBe(false);
    expect(self.signatureNeeds).toMatch(/3/);
    expect((await sign(w, null)).signatureHtml).toBeNull();
    w.set(w.moderator.id, { post_count: 3 });
    expect((await sign(w, "hello")).signatureHtml).toContain("hello");
    const after = await w.call("profiles.self", w.moderatorActor, {});
    expect(after.may.setSignature).toBe(true);
    expect(after.signatureNeeds).toBeNull();
  });

  test("a member without profile.signature is told nothing about the rule", async () => {
    const w = world();
    await settings(w, { signatureRule: rule });
    const self = await w.call("profiles.self", w.memberActor, {});
    expect(self.may.setSignature).toBe(false);
    expect(self.signatureNeeds).toBeNull();
  });

  test("days registered works the same way", async () => {
    const w = world();
    await settings(w, {
      signatureRule: { match: "all", conditions: [{ criterion: "days_registered", value: 5 }] },
    });
    w.set(w.moderator.id, { created_at: w.ctx.now() - 2 * 86_400_000 });
    await expect(sign(w, "hi")).rejects.toBeInstanceOf(ForbiddenError);
    w.set(w.moderator.id, { created_at: w.ctx.now() - 6 * 86_400_000 });
    await sign(w, "hi");
  });

  test("a stored signature of a member who stops qualifying stays stored but is not shown", async () => {
    const w = world();
    w.set(w.moderator.id, { post_count: 5 });
    await sign(w, "still here");
    await settings(w, { signatureRule: rule });
    const shown = await w.call("profiles.get", w.memberActor, { userId: w.moderator.id });
    expect(shown.signatureHtml).toContain("still here");
    w.set(w.moderator.id, { post_count: 1 });
    const hidden = await w.call("profiles.get", w.memberActor, { userId: w.moderator.id });
    expect(hidden.signatureHtml).toBeNull();
    const stored = w.ctx.sqlite
      .prepare<{ signature_source: string | null }, [number]>(
        "SELECT signature_source FROM users WHERE id = ?1",
      )
      .get(w.moderator.id);
    expect(stored?.signature_source).toBe("still here");
    // Their own edit form still has the text.
    const self = await w.call("profiles.self", w.moderatorActor, {});
    expect(self.signatureSource).toBe("still here");
  });

  test("an empty rule costs the cards no lookup", async () => {
    const w = world();
    await sign(w, "x");
    await w.call("profiles.get", w.memberActor, { userId: w.moderator.id });
    expect(w.ctx.statements.has("shared.criteriaMembers")).toBe(false);
    await settings(w, { signatureRule: rule });
    await w.call("profiles.get", w.memberActor, { userId: w.moderator.id });
    expect(w.ctx.statements.has("shared.criteriaMembers")).toBe(true);
  });

  test("an expensive criterion is refused in the setting", async () => {
    const w = world();
    await expect(
      settings(w, {
        signatureRule: {
          match: "all",
          conditions: [{ criterion: "warning_points_below", value: 3 }],
        },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("an administrator editing another member's signature is held to the limits, not the rule", async () => {
    const w = world();
    await settings(w, { signatureRule: rule, signatureFormats: ["bold"] });
    w.set(w.member.id, { post_count: 0 });
    await w.call("users.adminUpdateProfile", w.adminActor, {
      userId: w.member.id,
      signature: "**by staff**",
      reason: "test",
    });
    await expect(
      w.call("users.adminUpdateProfile", w.adminActor, {
        userId: w.member.id,
        signature: "*not allowed*",
        reason: "test",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
