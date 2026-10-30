import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { TargetMark } from "./hash-target";
import { SHOW_MS } from "./spotlight";

const css = readFileSync(
  new URL("../../app/globals.css", import.meta.url),
  "utf8",
);

// The declarations of the first rule whose selector is exactly `selector`.
function rule(selector: string, source = css) {
  const at = source.indexOf(`\n${selector} {`);
  if (at < 0) return "";
  return source.slice(at, source.indexOf("}", at));
}

const box = { top: 100, left: 20, width: 600, height: 300 };

test("the mark covers the target's box with a little room, and nothing else", () => {
  const html = renderToStaticMarkup(<TargetMark box={box} />);
  expect(html).toContain("top:96px");
  expect(html).toContain("left:16px");
  expect(html).toContain("width:608px");
  expect(html).toContain("height:308px");
  expect(html).toContain("target-mark");
  expect(html).toContain("pointer-events-none");
  expect(html).toContain('aria-hidden="true"');
});

test("the rest of the page keeps its brightness: no shadow spreads over the page", () => {
  const html = renderToStaticMarkup(<TargetMark box={box} />);
  expect(html).not.toContain("100vmax");
  expect(html).not.toContain("box-shadow");
  expect(css).not.toContain("--spotlight-dim");
  expect(rule(".target-mark")).not.toContain("100vmax");
});

test("the mark stays under the sticky header", () => {
  const html = renderToStaticMarkup(<TargetMark box={box} />);
  const classes = html.match(/class="([^"]*)"/)?.[1].split(" ") ?? [];
  expect(classes).toContain("z-20");
  expect(classes).not.toContain("z-50");
});

test("the mark is an edge in the ring colour and a light fill of the accent", () => {
  const mark = rule(".target-mark");
  expect(mark).toMatch(/border:\s*2px solid var\(--ring\)/);
  expect(mark).toMatch(
    /background-color:\s*color-mix\(in oklab, var\(--primary\) \d+%, transparent\)/,
  );
});

test("the mark fades out within the time it is shown", () => {
  const html = renderToStaticMarkup(<TargetMark box={box} />);
  expect(html).toContain(`animation-duration:${SHOW_MS}ms`);
  expect(rule(".target-mark")).toMatch(/animation:\s*target-mark\b/);
  const frames = rule("@keyframes target-mark");
  expect(frames).toContain("opacity: 0");
  expect(css.slice(css.indexOf("@keyframes target-mark"))).toMatch(
    /to \{\s*opacity: 0;\s*\}/,
  );
});

test("with less motion the mark shows without a fade, and the timer still takes it away", () => {
  const reduced = css.match(
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.target-mark \{([^}]*)\}/,
  );
  expect(reduced?.[1]).toMatch(/animation:\s*none/);
});
