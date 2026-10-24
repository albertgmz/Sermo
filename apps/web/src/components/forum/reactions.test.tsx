import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/threads/3",
  useSearchParams: () => new URLSearchParams(),
  // The reaction button holds the router (for the sign-in path); drawn here, nothing navigates.
  useRouter: () => ({
    push() {},
    replace() {},
    refresh() {},
    back() {},
    forward() {},
    prefetch() {},
  }),
}));
// Another suite replaces the translator with one that fills no placeholders: use the real one.
const intl = { ...(await import("next-intl")) };
const { useTranslations } = await import("use-intl");
mock.module("next-intl", () => ({
  ...intl,
  useLocale: () => "en",
  useTranslations,
}));
afterAll(() => {
  mock.module("next/navigation", () => navigation);
  mock.module("next-intl", () => intl);
});
const { Reactions } = await import("./reactions");

import type { ReactionType } from "./reaction-button";
import type { ReactionPictureData } from "./reaction-picture";

const LIKE = {
  id: 1,
  title: "Like",
  emoji: "👍",
  isActive: true,
  image: null,
  frames: null,
};
const LOVE = {
  id: 2,
  title: "Love",
  emoji: "❤️",
  isActive: true,
  image: null,
  frames: null,
};
const reactionTypes = [LIKE, LOVE] as Parameters<
  typeof Reactions
>[0]["reactionTypes"];
const picker = [
  { id: 1, key: "1", label: "Like", emoji: "👍", picture: null },
  { id: 2, key: "2", label: "Love", emoji: "❤️", picture: null },
];
const none = { counts: {}, total: 0, mine: null };
const some = { counts: { "1": 3, "2": 1 }, total: 4, mine: null };

function render(
  viewerId: number | null,
  reactions: {
    counts: Record<string, number>;
    total: number;
    mine: number | null;
  },
  authorId = 7,
  types = picker,
  part?: "both" | "button" | "summary",
) {
  return renderToStaticMarkup(
    withIntl(
      <Reactions
        part={part}
        target="post"
        id={5}
        reactions={reactions}
        authorId={authorId}
        viewerId={viewerId}
        picker={types}
        reactionTypes={reactionTypes}
      />,
    ),
  );
}

// The number as text between tags, which is how a count is drawn.
const shown = (html: string, n: number) =>
  html.split(new RegExp(`>${n}<`)).length - 1;

// The button's own text: what lies between its tag and the picker's trigger or its end.
const buttonText = (html: string) =>
  (
    html.match(
      /<(?:button|a)[^>]*(?:aria-pressed|href="\/login)[^>]*>(.*?)<\/(?:button|a)>/,
    )?.[1] ?? ""
  )
    .replace(/<svg.*?<\/svg>/g, "<svg/>")
    .replace(/<[^>]+>/g, (tag) => (tag === "<svg/>" ? "♡" : ""));

test("a guest gets the sign-in link named for the first reaction, and the summary carries the number", () => {
  const html = render(null, some);
  expect(html).toContain('href="/login?next=%2Fthreads%2F3"');
  expect(html).toContain("Log in to react, 4 reactions");
  expect(buttonText(html)).toBe("♡Like");
  expect(html).toContain("4 reactions, show who reacted");
  expect(shown(html, 4)).toBe(1);
});

test("a guest sees the link even where nobody reacted", () => {
  const html = render(null, none);
  expect(html).toContain("Log in to react");
  expect(html).not.toContain("show who reacted");
});

test("on your own item there is nothing to press and the summary shows the number", () => {
  const html = render(7, some);
  expect(html).not.toContain("aria-pressed");
  expect(html).not.toContain("Choose a reaction");
  expect(html).toContain("4 reactions, show who reacted");
  expect(shown(html, 4)).toBe(1);
});

test("your own item without reactions draws nothing at all", () => {
  expect(render(7, none)).toBe("");
});

test("an item that takes no reactions and has none draws nothing", () => {
  expect(render(9, none, 7, [])).toBe("");
});

test("another member's item with reactions: the button says what a press gives, the number is in the summary once", () => {
  const html = render(9, some);
  expect(html).toContain("Like, 4 reactions");
  expect(html).toContain("Choose a reaction");
  expect(buttonText(html)).toBe("♡Like");
  expect(html).toContain("4 reactions, show who reacted");
  expect(shown(html, 4)).toBe(1);
});

test("the viewer's own reaction shows on the button as its picture and its name, without a count", () => {
  const html = render(
    9,
    { counts: { "2": 3 }, total: 3, mine: 2 },
    7,
    picker,
    "button",
  );
  expect(html).toContain('aria-pressed="true"');
  expect(buttonText(html)).toBe("❤️Love");
  expect(shown(html, 3)).toBe(0);
});

test("the button's name is a word from sm up; on a phone it is the icon alone", () => {
  const html = render(9, none, 7, picker, "button");
  expect(html).toContain('<span class="hidden sm:inline">Like</span>');
});

test("under a bar the summary is XenForo's reactions bar: a full-width row with the faces and the total in words", () => {
  const html = render(9, some, 7, picker, "summary");
  const bar = html.match(/<button[^>]*>/)?.[0] ?? "";
  expect(bar).toContain("w-full");
  expect(html).toContain(">4 reactions<");
  expect(html.indexOf("👍")).toBeLessThan(html.indexOf(">4 reactions<"));
});

test("another member's item without reactions has the button only", () => {
  const html = render(9, none);
  expect(html).toContain('aria-pressed="false"');
  expect(html).not.toContain("show who reacted");
  expect(shown(html, 0)).toBe(0);
});

const SPARK: ReactionType = {
  id: 3,
  key: "3",
  label: "Spark",
  emoji: "✨",
  picture: {
    url: "/api/v1/files/9",
    frames: { width: 16, height: 16, count: 3, columns: 3 },
  } as ReactionPictureData,
};

test("the button and the summary draw a type's picture instead of its emoji", () => {
  const html = renderToStaticMarkup(
    withIntl(
      <Reactions
        target="post"
        id={5}
        reactions={{ counts: { "3": 2 }, total: 2, mine: 3 }}
        authorId={7}
        viewerId={9}
        picker={[...picker, SPARK]}
        reactionTypes={
          [
            {
              id: 3,
              title: "Spark",
              emoji: "✨",
              isActive: true,
              image: { fileId: 9, url: "/api/v1/files/9" },
              frames: SPARK.picture?.frames,
            },
          ] as Parameters<typeof Reactions>[0]["reactionTypes"]
        }
      />,
    ),
  );
  // The button (the viewer's own reaction) and the summary stack; the picker is closed.
  expect(html.split('data-slot="reaction-picture"').length - 1).toBe(2);
  expect(html).toContain("background-image:url(&quot;/api/v1/files/9&quot;)");
  expect(html).not.toContain("✨");
});

test("without reaction.viewList the summary shows the counts and offers no list of who reacted", () => {
  const html = renderToStaticMarkup(
    withIntl(
      <Reactions
        part="summary"
        target="post"
        id={5}
        reactions={some}
        authorId={7}
        viewerId={9}
        picker={picker}
        reactionTypes={reactionTypes}
        viewList={false}
      />,
    ),
  );
  expect(html).toContain("4 reactions, show the reactions");
  expect(html).not.toContain("show who reacted");
});

test("a bar draws the button and the summary apart, each once", () => {
  const button = render(9, some, 7, picker, "button");
  expect(button).toContain("Choose a reaction");
  expect(button).not.toContain("show who reacted");
  const summary = render(9, some, 7, picker, "summary");
  expect(summary).toContain("4 reactions, show who reacted");
  expect(summary).not.toContain("Choose a reaction");
  expect(summary).not.toContain("aria-pressed");
});

test("the summary alone shows the number where there is no button, and nothing without reactions", () => {
  expect(render(7, some, 7, picker, "summary")).toContain(">4 reactions<");
  expect(render(9, none, 7, picker, "summary")).toBe("");
  expect(render(7, some, 7, picker, "button")).toBe("");
});

test("a tap on the button names the first reaction the viewer may give, not a locked one", () => {
  const locked = {
    ...picker[0],
    locked: "Unlocks with: Post count: 500 or more",
  };
  const html = render(9, none, 7, [locked, picker[1]], "button");
  expect(html).toContain('aria-label="Love, 0 reactions"');
  expect(html).not.toContain('aria-label="Like, 0 reactions"');
});

test("when every reaction is locked the button is still drawn, to open the picker", () => {
  const html = render(
    9,
    none,
    7,
    picker.map((type) => ({ ...type, locked: "Locked" })),
    "button",
  );
  expect(html).toContain("Choose a reaction");
});

test("the viewer's own reaction is drawn in the button although its type is not offered", () => {
  const html = renderToStaticMarkup(
    withIntl(
      <Reactions
        part="button"
        target="post"
        id={5}
        reactions={{ counts: { "2": 1 }, total: 1, mine: 2 }}
        authorId={7}
        viewerId={9}
        picker={[picker[0]]}
        reactionTypes={reactionTypes}
      />,
    ),
  );
  expect(html).toContain('aria-label="Love, 1 reaction"');
});
