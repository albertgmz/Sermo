import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import type { ForumArtUrl } from "./forum-choice-art";
import { ForumChoicePanel, monogram } from "./forum-choice-panel";
import type { ForumChoice } from "./forum-choices";

const forum = (
  id: number,
  parentId: number | null,
  title: string,
  over: Partial<ForumChoice> = {},
): ForumChoice => ({
  id,
  parentId,
  title,
  type: "forum",
  canPost: true,
  readOnly: false,
  image: null,
  ...over,
});

const FORUMS = [
  forum(1, null, "Soporte", { type: "category", canPost: false }),
  forum(2, 1, "Ayuda", {
    image: { url: "/api/v1/files/20" as ForumArtUrl, kind: "cover" },
  }),
  forum(3, 1, "Errores"),
  forum(4, 1, "Anuncios", { readOnly: true }),
  forum(5, 1, "Deportes", {
    image: { url: "/api/v1/files/50" as ForumArtUrl, kind: "icon" },
  }),
  forum(6, null, "Charla"),
];

function draw(current: number | null = null) {
  return renderToStaticMarkup(
    withIntl(
      <ForumChoicePanel
        forums={FORUMS}
        current={current}
        onChoose={() => {}}
        onBack={() => {}}
      />,
    ),
  );
}

// The markup of the tile of one forum, from its button to the end of its list item.
function tile(html: string, title: string) {
  const at = html.indexOf(`>${title}<`);
  const start = html.lastIndexOf("<button", at);
  return html.slice(start, html.indexOf("</li>", at));
}

test("a forum with a cover draws it behind its title, lazily, under a scrim", () => {
  const html = tile(draw(), "Ayuda");
  expect(html).toContain('data-forum-tile="cover"');
  expect(html).toMatch(
    /<img src="\/api\/v1\/files\/20" alt="" loading="lazy" decoding="async"[^>]*class="[^"]*absolute inset-0/,
  );
  expect(html).toContain("from-card from-30%");
});

test("a forum with only an icon draws it small, beside its title, over the accent wash", () => {
  const html = tile(draw(), "Deportes");
  expect(html).toContain('data-forum-tile="icon"');
  expect(html).toMatch(
    /<img src="\/api\/v1\/files\/50" alt="" loading="lazy"[^>]*class="[^"]*size-10/,
  );
  expect(html).toContain("from-primary/10");
});

test("a forum without a picture gets the accent wash and its letter instead", () => {
  const html = tile(draw(), "Errores");
  expect(html).toContain('data-forum-tile="plain"');
  expect(html).not.toContain("<img");
  expect(html).toContain("from-primary/10");
  expect(html).toMatch(/text-primary-ink">E</);
});

test("forums at the root after a category come under a heading of their own", () => {
  const html = draw();
  expect(html.indexOf(">More forums<")).toBeGreaterThan(
    html.indexOf(">Errores<"),
  );
  expect(html.indexOf(">More forums<")).toBeLessThan(html.indexOf(">Charla<"));
});

test("the category heading folds its forums, and a read-only forum is not there", () => {
  const html = draw();
  expect(html).toMatch(/<h3><button type="button" aria-expanded="true"/);
  expect(html).toContain(">Soporte<");
  expect(html).not.toContain("Anuncios");
});

test("the forum the composer has now is marked", () => {
  expect(tile(draw(3), "Errores")).toContain('aria-current="true"');
  expect(tile(draw(3), "Ayuda")).not.toContain("aria-current");
});

test("the letter of a forum is its first character, upper case, an emoji included", () => {
  expect(monogram("  ayuda")).toBe("A");
  expect(monogram("🎮 Juegos")).toBe("🎮");
  expect(monogram("")).toBe("");
});
