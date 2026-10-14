import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { REACTION_FRAME_MS, ReactionPicture } from "./reaction-picture";

const SRC = "/api/v1/files/9";

test("without a picture the emoji is drawn as text", () => {
  const html = renderToStaticMarkup(
    <ReactionPicture emoji="👍" picture={null} label="Like" />,
  );
  expect(html).toContain("👍");
  expect(html).toContain('role="img"');
  expect(html).toContain('aria-label="Like"');
  expect(html).not.toContain("background-image");
});

test("an unlabelled emoji or picture is hidden from assistive technology", () => {
  const emoji = renderToStaticMarkup(
    <ReactionPicture emoji="👍" picture={null} />,
  );
  expect(emoji).toContain('aria-hidden="true"');
  expect(emoji).not.toContain("aria-label");
  const picture = renderToStaticMarkup(
    <ReactionPicture emoji="👍" picture={{ url: SRC, frames: null }} />,
  );
  expect(picture).toContain('aria-hidden="true"');
});

test("a plain image is one still box named by the label, and the emoji is not drawn", () => {
  const html = renderToStaticMarkup(
    <ReactionPicture
      emoji="👍"
      picture={{ url: SRC, frames: null }}
      label="Like"
    />,
  );
  expect(html).toContain(`background-image:url(&quot;${SRC}&quot;)`);
  expect(html).toContain('role="img"');
  expect(html).toContain('aria-label="Like"');
  expect(html).toContain("bg-contain");
  expect(html).not.toContain("👍");
  expect(html).not.toContain("<style");
  expect(html).not.toContain("animate-");
});

test("a sprite sheet is a box of one frame stepped by a CSS animation with a rule shared by equal sheets", () => {
  const frames = { width: 32, height: 16, count: 5, columns: 3 };
  const html = renderToStaticMarkup(
    <>
      <ReactionPicture emoji="x" picture={{ url: SRC, frames }} label="Pulse" />
      <ReactionPicture emoji="x" picture={{ url: SRC, frames }} label="Pulse" />
    </>,
  );
  // The box is one frame: twice as wide as it is tall, and the sheet is three boxes wide.
  expect(html).toContain("width:2.5em");
  expect(html).toContain("height:1.25em");
  expect(html).toContain("background-size:300% auto");
  expect(html).toContain(
    `--rx-anim:rx-3-5 ${5 * REACTION_FRAME_MS}ms step-end infinite`,
  );
  // Frames read left to right, then top to bottom: the fourth is the first of the second row.
  expect(html).toContain("@keyframes rx-3-5{");
  expect(html).toContain(
    "0.0000%{background-position:calc(var(--rx-w)*-0) calc(var(--rx-h)*-0)}",
  );
  expect(html).toContain(
    "60.0000%{background-position:calc(var(--rx-w)*-0) calc(var(--rx-h)*-1)}",
  );
  expect(html).toContain(
    "80.0000%{background-position:calc(var(--rx-w)*-1) calc(var(--rx-h)*-1)}",
  );
  expect(html.split("@keyframes rx-3-5").length - 1).toBe(1);
  expect(html.split('data-slot="reaction-picture"').length - 1).toBe(2);
});

test("a sprite animates unless the visitor asks for reduced motion, then it stays on its first frame", () => {
  const html = renderToStaticMarkup(
    <ReactionPicture
      emoji="x"
      picture={{
        url: SRC,
        frames: { width: 16, height: 16, count: 2, columns: 2 },
      }}
    />,
  );
  expect(html).toContain("animate-(--rx-anim)");
  expect(html).toContain("motion-reduce:animate-none");
  expect(html).toContain("background-position:0 0");
});

test("a cut of one frame is still and draws no animation", () => {
  const html = renderToStaticMarkup(
    <ReactionPicture
      emoji="x"
      picture={{
        url: SRC,
        frames: { width: 16, height: 16, count: 1, columns: 4 },
      }}
    />,
  );
  expect(html).toContain("background-size:400% auto");
  expect(html).not.toContain("<style");
  expect(html).not.toContain("animate-");
});
