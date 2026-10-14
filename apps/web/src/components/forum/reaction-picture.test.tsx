import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  cssUrl,
  REACTION_FRAME_MS,
  ReactionPicture,
  type ReactionPictureData,
} from "./reaction-picture";

// What the seam hands over; a test makes it by hand.
const sealed = (data: { url: string; frames: ReactionPictureData["frames"] }) =>
  data as ReactionPictureData;

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
    <ReactionPicture emoji="👍" picture={sealed({ url: SRC, frames: null })} />,
  );
  expect(picture).toContain('aria-hidden="true"');
});

test("a plain image is one still box named by the label, and the emoji is not drawn", () => {
  const html = renderToStaticMarkup(
    <ReactionPicture
      emoji="👍"
      picture={sealed({ url: SRC, frames: null })}
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
      <ReactionPicture
        emoji="x"
        picture={sealed({ url: SRC, frames })}
        label="Pulse"
      />
      <ReactionPicture
        emoji="x"
        picture={sealed({ url: SRC, frames })}
        label="Pulse"
      />
    </>,
  );
  // The outer box is the square the emoji gets; the frame (twice as wide as tall) is fitted
  // into it by its width, rounded to whole pixels, and the sheet is three frames wide.
  expect(html).toContain("size-[1.25em]");
  expect(html).toContain("--rx-w:round(down, 1.2500em, 1px)");
  expect(html).toContain("--rx-h:calc(var(--rx-w) * 0.500000)");
  expect(html).toContain("background-size:calc(var(--rx-w) * 3) auto");
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
      picture={sealed({
        url: SRC,
        frames: { width: 16, height: 16, count: 2, columns: 2 },
      })}
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
      picture={sealed({
        url: SRC,
        frames: { width: 16, height: 16, count: 1, columns: 4 },
      })}
    />,
  );
  expect(html).toContain("background-size:calc(var(--rx-w) * 4) auto");
  expect(html).not.toContain("<style");
  expect(html).not.toContain("animate-");
});

test("a tall frame is fitted by its height and still sits in the square box", () => {
  const html = renderToStaticMarkup(
    <ReactionPicture
      emoji="x"
      picture={sealed({
        url: SRC,
        frames: { width: 16, height: 32, count: 2, columns: 2 },
      })}
    />,
  );
  expect(html).toContain("size-[1.25em]");
  expect(html).toContain("--rx-w:round(down, 0.6250em, 1px)");
  expect(html).toContain("--rx-h:calc(var(--rx-w) * 2.000000)");
});

test("an address cannot end the CSS string it is written into", () => {
  expect(cssUrl("/api/v1/files/9")).toBe('url("/api/v1/files/9")');
  // A quote, a backslash, a line feed, a carriage return and a form feed.
  const hostile = '/x");background:red;("' + "\\" + "\n" + "\r" + "\f";
  expect(cssUrl(hostile)).toBe(
    'url("/x\\");background:red;(\\"' +
      "\\\\" +
      "\\a " +
      "\\d " +
      "\\c " +
      '")',
  );
  const html = renderToStaticMarkup(
    <ReactionPicture
      emoji="x"
      picture={sealed({ url: hostile, frames: null })}
    />,
  );
  // The quote that would have ended the string stays behind its backslash.
  expect(html).toContain("/x\\&quot;);background:red;(\\&quot;");
});
