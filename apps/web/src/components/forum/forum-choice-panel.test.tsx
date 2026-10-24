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
  forum(2, 1, "Ayuda", { image: "/api/v1/files/20" as ForumArtUrl }),
  forum(3, 1, "Errores"),
  forum(4, 1, "Anuncios", { readOnly: true }),
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

test("a forum with a picture draws it behind its title, lazily, under a scrim", () => {
  const html = tile(draw(), "Ayuda");
  expect(html).toContain('data-forum-tile="picture"');
  expect(html).toMatch(
    /<img src="\/api\/v1\/files\/20" alt="" loading="lazy" decoding="async"/,
  );
  expect(html).toContain("from-background/95");
});

test("a forum without a picture gets the accent wash and its letter instead", () => {
  const html = tile(draw(), "Errores");
  expect(html).toContain('data-forum-tile="plain"');
  expect(html).not.toContain("<img");
  expect(html).toContain("from-primary/15");
  expect(html).toMatch(/text-primary-ink\/15[^"]*">E</);
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
