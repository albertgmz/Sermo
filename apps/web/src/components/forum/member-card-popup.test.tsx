import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Suspense } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CardBody, keepOpenWhileHeld } from "./member-card-popup";
import { holdMemberCards } from "./member-card-scope";

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

test("while a dialog opened from the card is open, nothing closes the card", () => {
  const asked: boolean[] = [];
  const change = keepOpenWhileHeld((open) => asked.push(open));
  const outside = { reason: "outside-press", event: new Event("pointerdown") };
  const release = holdMemberCards();
  change(false, outside);
  change(false, { reason: "escape-key", event: new Event("keydown") });
  change(true, outside);
  expect(asked).toEqual([true]);
  release();
  change(false, outside);
  expect(asked).toEqual([true, false]);
});

test("the block dialog holds the card while it is open, and both frames of the card obey", () => {
  const button = readFileSync(
    new URL("./member-follow-button.tsx", import.meta.url),
    "utf8",
  );
  expect(button).toContain(
    "release.current = open ? holdMemberCards() : null;",
  );
  expect(button).toMatch(/onOpenChange=\{ask\}/);
  // The hold ends after the closing gesture, and a confirmed change holds until it is answered.
  expect(button).toContain("if (held) setTimeout(held, 300);");
  expect(button).toContain("return action(!on).finally(busy);");
  const popup = readFileSync(
    new URL("./member-card-popup.tsx", import.meta.url),
    "utf8",
  );
  expect(popup).toContain(
    "<Popover open={open && wide} onOpenChange={change}>",
  );
  expect(popup).toContain("<Sheet open={open && !wide} onOpenChange={change}>");
});
