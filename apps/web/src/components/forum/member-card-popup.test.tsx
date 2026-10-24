import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Suspense } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CardBody } from "./member-card-popup";

function Slow(): never {
  throw new Promise(() => {});
}

test("a card that suspends is held by its own skeleton, never by the page's boundary", () => {
  const out = renderToStaticMarkup(
    <Suspense fallback={<p>PAGE FALLBACK</p>}>
      <div id="list">
        <CardBody card={<Slow />} reload={() => {}} />
      </div>
    </Suspense>,
  );
  expect(out).not.toContain("PAGE FALLBACK");
  expect(out).toContain('data-slot="skeleton"');
});

test("before the first read the skeleton is drawn, afterwards the card", () => {
  expect(
    renderToStaticMarkup(<CardBody card={undefined} reload={() => {}} />),
  ).toContain('data-slot="skeleton"');
  expect(
    renderToStaticMarkup(<CardBody card={<b>card</b>} reload={() => {}} />),
  ).toBe("<b>card</b>");
});

test("the card's popover is drawn on the raised surface, a layer above the posts", () => {
  const source = readFileSync(
    new URL("./member-card-popup.tsx", import.meta.url),
    "utf8",
  );
  const popover = source.slice(source.indexOf("<PopoverContent"));
  expect(popover.slice(0, popover.indexOf(">"))).toContain("bg-raised");
});
