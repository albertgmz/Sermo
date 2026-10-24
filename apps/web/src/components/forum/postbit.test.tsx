import { afterAll, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import type { AuthorView } from "@/lib/sermo/views";
import { withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/threads/1",
  useSearchParams: () => new URLSearchParams(),
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
const { Postbit } = await import("./postbit");
const { MemberCardScope } = await import("./member-card-scope");
const { plainAuthor } = await import("@/lib/sermo/members");

const author = {
  member: {
    id: 3,
    username: "ember",
    avatar: null,
    frame: null,
    nameColor: null,
    title: "Senior member",
    badges: [],
    level: 2,
    restricted: false,
  },
  cover: null,
  joinedAt: "2025-03-14T10:00:00.000Z",
  postCount: 1280,
  reactionScore: 940,
  xp: 150,
  currentLevelXp: 100,
  nextLevelXp: 300,
  awards: [],
  signatureHtml: null,
} as unknown as AuthorView;

async function html(node: ReactNode) {
  const stream = await renderToReadableStream(withIntl(node));
  await stream.allReady;
  return new Response(stream).text();
}

test("the column draws the name, the title and the facts", async () => {
  const out = await html(<Postbit author={author} layout="column" />);
  expect(out).toContain("ember");
  expect(out).toContain("Senior member");
  for (const label of ["Joined", "Posts", "Reactions"]) {
    expect(out).toContain(`>${label}</dt>`);
  }
  expect(out).toContain('dateTime="2025-03-14T10:00:00.000Z"');
  expect(out).toContain(">1.3K<");
  expect(out).toContain(">940<");
});

test("the compact header has no list of facts and keeps the counts on one line", async () => {
  const out = await html(<Postbit author={author} layout="compact" />);
  expect(out).not.toContain("<dl");
  expect(out).toContain("Senior member");
  expect(out).toContain("Messages");
  expect(out).toContain('data-layout="compact"');
});

const LAYOUTS = ["column", "compact", "responsive"] as const;
const AWARDS = [
  { id: 1, name: "First post", icon: "star", tier: "gold" },
  { id: 2, name: "Helper", icon: "heart", tier: "silver" },
] as AuthorView["awards"];
const restricted = {
  ...author,
  member: { ...author.member, restricted: true },
  joinedAt: "1970-01-01T00:00:00.000Z",
  postCount: 0,
  reactionScore: 0,
} as AuthorView;
// The member the backend did not return: what the web falls back to.
const unknown = plainAuthor({ id: 9, username: "ghost" });

test("the explicit layouts draw only their own arrangement", async () => {
  const column = await html(<Postbit author={author} layout="column" />);
  expect(column).toContain("<dl");
  expect(column).not.toContain(">Messages<");
  const compact = await html(<Postbit author={author} layout="compact" />);
  expect(compact).not.toContain("<dl");
  expect(compact).toContain("Messages");
});

test("the responsive layout draws both arrangements and hides each by class below or above md", async () => {
  const out = await html(<Postbit author={author} />);
  expect(out).toContain('data-layout="responsive"');
  expect(out).toContain("<dl");
  expect(out).toContain("Messages");
  expect(out).toContain("md:hidden");
  expect(out).toContain("hidden md:inline-flex");
  expect(out).toContain("hidden md:grid");
});

test("the profile is linked from the avatar and the name, with no button", async () => {
  const out = await html(<Postbit author={author} layout="column" />);
  expect(out).toContain('href="/members/3"');
  expect(out).not.toContain("<button");
});

for (const layout of LAYOUTS) {
  test(`${layout}: a member the backend did not return renders with name only and no facts`, async () => {
    const out = await html(<Postbit author={unknown} layout={layout} />);
    expect(out).toContain("ghost");
    expect(out).not.toContain("<dl");
    expect(out).not.toContain("Joined");
    expect(out).not.toContain("Messages");
    expect(out).not.toContain("1970");
  });

  test(`${layout}: a restricted member shows no facts but keeps name, title and badges`, async () => {
    const out = await html(
      <Postbit
        layout={layout}
        author={
          {
            ...restricted,
            member: {
              ...restricted.member,
              badges: [{ label: "Gold", color: null, style: "outline" }],
            },
          } as AuthorView
        }
      />,
    );
    expect(out).toContain("ember");
    expect(out).toContain("Senior member");
    expect(out).toContain("Gold");
    for (const text of ["<dl", "Joined", "Posts", "Reactions", "Messages"]) {
      expect(out).not.toContain(text);
    }
    expect(out).not.toContain("1970");
    expect(out).not.toContain("LVL");
  });

  test(`${layout}: the actions slot is drawn only when given`, async () => {
    expect(
      await html(<Postbit author={author} layout={layout} />),
    ).not.toContain("postbit-actions");
    const out = await html(
      <Postbit
        author={author}
        layout={layout}
        actions={<i data-mark="follow" />}
      />,
    );
    expect(out).toContain("postbit-actions");
    expect(out).toContain('data-mark="follow"');
  });
}

test("a joined date that is not usable draws no joined row", async () => {
  const out = await html(
    <Postbit author={{ ...author, joinedAt: "" }} layout="column" />,
  );
  expect(out).not.toContain("Joined");
  expect(out).toContain("Posts");
});

test("a member without a title leaves no empty row in the column", async () => {
  const rows = (out: string) =>
    out.match(/<div class="flex w-full min-w-0 flex-col items-center gap-2">/g)
      ?.length ?? 0;
  const titled = await html(<Postbit author={author} layout="column" />);
  const bare = await html(
    <Postbit
      author={{ ...author, member: { ...author.member, title: "" } }}
      layout="column"
    />,
  );
  expect(bare).not.toContain("<p ");
  expect(rows(bare)).toBe(rows(titled) - 1);
});

test("a title that only repeats the group's badge is shown once, as the badge", async () => {
  const badge = { label: "Moderator", color: null, style: "tint" };
  const withTitle = (title: string) => ({
    ...author,
    member: { ...author.member, title, badges: [badge] },
  });
  for (const layout of LAYOUTS) {
    const repeated = await html(
      <Postbit author={withTitle("Moderator") as never} layout={layout} />,
    );
    expect(repeated.match(/Moderator/g), layout).toHaveLength(1);
    const added = await html(
      <Postbit
        author={withTitle("Garden moderator") as never}
        layout={layout}
      />,
    );
    expect(added, layout).toContain("Garden moderator");
  }
});

test("the actions sit under the name and before the title, in every layout", async () => {
  for (const layout of LAYOUTS) {
    const out = await html(
      <Postbit author={author} layout={layout} actions={<i />} />,
    );
    const actions = out.indexOf("postbit-actions");
    expect(out.indexOf(">ember</")).toBeLessThan(actions);
    expect(actions).toBeLessThan(out.indexOf(">Senior member</p>"));
    expect(out).not.toContain("mt-auto");
  }
});

test("the column draws its parts in one order: avatar, name, actions, title, level, awards, facts", async () => {
  const out = await html(
    <Postbit
      author={{ ...author, awards: AWARDS }}
      layout="column"
      actions={<i data-mark="actions" />}
    />,
  );
  const order = [
    'data-slot="avatar"',
    ">ember</",
    'data-mark="actions"',
    ">Senior member</p>",
    'data-slot="postbit-level"',
    'href="/awards"',
    "<dl",
  ].map((part) => out.indexOf(part));
  expect(order).not.toContain(-1);
  expect(order).toEqual([...order].sort((a, b) => a - b));
});

test("the avatar and the name open the member's card, and are plain links inside a card", async () => {
  for (const layout of ["column", "compact", "responsive"] as const) {
    const out = await html(<Postbit author={author} layout={layout} />);
    expect(out).toContain('href="/members/3"');
    expect(out).toContain('role="link"');
    const inCard = await html(
      <MemberCardScope disabled>
        <Postbit author={author} layout={layout} />
      </MemberCardScope>,
    );
    expect(inCard).toContain('href="/members/3"');
    expect(inCard).not.toContain('role="link"');
  }
});

// The class contract of a long name with an icon; how it looks needs a browser.
const LONG = {
  ...author,
  member: {
    ...author.member,
    username: "Bartholomew_Featherstonehaugh30",
    nameIcon: { icon: "star", position: "after" },
  },
} as unknown as AuthorView;

test("in the column a long name wraps within the column beside its icon", async () => {
  const out = await html(<Postbit author={LONG} layout="column" />);
  expect(out).toContain(
    '<span class="min-w-0 whitespace-normal [overflow-wrap:anywhere]">Bartholomew_Featherstonehaugh30</span>',
  );
  expect(out).not.toContain('<span class="min-w-0 truncate">');
  expect(out).toContain("shrink-0");
  expect(out).toContain("max-w-full min-w-0");
});

test("in the compact header a long name truncates beside its badge, never below 12 characters, with the buttons on another line", async () => {
  const out = await html(
    <Postbit
      author={{
        ...LONG,
        member: {
          ...LONG.member,
          badges: [
            { label: "Administrator", color: null, style: "solid" },
            { label: "Supporter", color: null, style: "outline" },
          ],
        },
      }}
      layout="compact"
      actions={<i data-mark="actions" />}
    />,
  );
  expect(out).toContain(
    '<span class="min-w-0 truncate">Bartholomew_Featherstonehaugh30</span>',
  );
  expect(out).toContain("shrink-0");
  // the name's row spans every track beside the avatar: the buttons do not share it
  expect(out).toContain("col-start-2 col-end-5 row-start-1 grid min-w-0");
  // the name keeps at least 12 characters, the badges get the rest of the line
  expect(out).toContain("grid-cols-[minmax(min(12ch,100%),max-content)_auto]");
  // only the first (highest) badge is shown there, so it stays on the name's line
  expect(out).toContain("[&amp;&gt;*:nth-child(n+2)]:hidden");
  // the buttons end the line under the title
  expect(out).toContain("col-start-4 row-start-3");
});

test("the responsive layout truncates below md and wraps from md", async () => {
  const out = await html(<Postbit author={LONG} layout="responsive" />);
  expect(out).toContain("min-w-0 truncate md:overflow-visible");
  expect(out).toContain("md:whitespace-normal md:[overflow-wrap:anywhere]");
});

test("a name without an icon wraps as plain text in the column and truncates in the compact header", async () => {
  const column = await html(<Postbit author={author} layout="column" />);
  expect(column).toContain("[overflow-wrap:anywhere]");
  expect(column).toContain(">ember</a>");
  const compact = await html(<Postbit author={author} layout="compact" />);
  expect(compact).toContain('<span class="min-w-0 truncate">ember</span>');
});

test("the avatars of a postbit stay lazy: the responsive layout holds two and one is hidden", async () => {
  const withPicture = {
    ...author,
    member: {
      ...author.member,
      avatar: { fileId: 1, url: "/big.webp", smallUrl: "/small.webp" },
    },
  } as unknown as AuthorView;
  const out = await html(<Postbit author={withPicture} layout="responsive" />);
  const pictures = out.match(/<img[^>]*>/g) ?? [];
  expect(pictures.length).toBe(2);
  for (const picture of pictures) {
    expect(picture).toContain('loading="lazy"');
    expect(picture).not.toContain('loading="eager"');
  }
});

test("the cover is drawn behind the block when the member has one, and nothing without", async () => {
  for (const layout of LAYOUTS) {
    const covered = await html(
      <Postbit
        author={{ ...author, cover: { url: "/cover.webp" } }}
        layout={layout}
        coverClassName="cover-shape"
      />,
    );
    expect(covered).toContain("url(&quot;/cover.webp&quot;)");
    expect(covered).toContain("-z-10");
    expect(covered).toContain("cover-shape");
    // the column's shape (the whole height, fading down) wherever the column is drawn
    const shape = "h-full w-[var(--postbit-cover-width,100%)]";
    if (layout === "compact") expect(covered).not.toContain(shape);
    else
      expect(covered).toContain(
        layout === "column" ? ` ${shape}` : "md:h-full",
      );
    const bare = await html(<Postbit author={author} layout={layout} />);
    expect(bare).not.toContain("background-image");
    expect(bare).not.toContain("-z-10");
  }
});

test("the awards: under the title in the compact header, a row of their own in the column, none without", async () => {
  const count = (out: string) => out.split('href="/awards"').length - 1;
  const withAwards = { ...author, awards: AWARDS };
  const compact = await html(<Postbit author={withAwards} layout="compact" />);
  expect(count(compact)).toBe(1);
  // placed on the grid at the start of the line under the title
  expect(compact).toContain("col-start-2 row-start-3");
  const column = await html(<Postbit author={withAwards} layout="column" />);
  expect(count(column)).toBe(1);
  expect(column.indexOf('href="/awards"')).toBeGreaterThan(
    column.indexOf('data-slot="postbit-level"'),
  );
  // the responsive layout draws them once, placed by the grid below md and in the column from md
  const both = await html(<Postbit author={withAwards} />);
  expect(count(both)).toBe(1);
  for (const layout of LAYOUTS) {
    expect(count(await html(<Postbit author={author} layout={layout} />))).toBe(
      0,
    );
  }
});
