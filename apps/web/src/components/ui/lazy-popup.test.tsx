import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  HOVER_DELAY,
  hovers,
  isPlainClick,
  menuOpening,
  openedByClick,
  opensFromKey,
} from "./lazy-popup-intent";
import { LazyPopup } from "./lazy-popup";
import { LazyTooltip } from "./lazy-tooltip";

const click = {
  button: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
};

test("a plain click opens, a modified or non-primary click is left to the browser", () => {
  expect(isPlainClick(click)).toBe(true);
  expect(isPlainClick({ ...click, ctrlKey: true })).toBe(false);
  expect(isPlainClick({ ...click, metaKey: true })).toBe(false);
  expect(isPlainClick({ ...click, shiftKey: true })).toBe(false);
  expect(isPlainClick({ ...click, button: 1 })).toBe(false);
});

test("the arrow keys open a menu and nothing else", () => {
  expect(opensFromKey("menu", "ArrowDown")).toBe(true);
  expect(opensFromKey("menu", "ArrowUp")).toBe(true);
  expect(opensFromKey("menu", "Enter")).toBe(false);
  expect(opensFromKey("click", "ArrowDown")).toBe(false);
  expect(opensFromKey("hover", "ArrowDown")).toBe(false);
});

test("a touch is no hover", () => {
  expect(hovers({ pointerType: "mouse" })).toBe(true);
  expect(hovers({ pointerType: "pen" })).toBe(true);
  expect(hovers({ pointerType: "touch" })).toBe(false);
});

test("before the code is there the page holds the caller's plain trigger and nothing else", () => {
  const html = renderToStaticMarkup(
    <LazyPopup
      load={async () => ({ default: () => <p>real popup</p> })}
      popup={{}}
      trigger={(lazy) => (
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded="false"
          {...lazy}
        >
          Menu
        </button>
      )}
    />,
  );
  expect(html).toBe(
    '<button type="button" aria-haspopup="menu" aria-expanded="false">Menu</button>',
  );
});

// A static import of a Base UI popup part in a trigger's file would put its code, and the
// positioning library with it, back in the first load of every page.
const LAYOUT = join(import.meta.dir, "../layout");
const LIGHT = [
  "guest-menu.tsx",
  "header-panel.tsx",
  "site-nav.tsx",
  "user-menu.tsx",
];
const HEAVY =
  /from "@\/components\/ui\/(popover|dropdown-menu|sheet|tooltip|hover-card|tabs)"/;

test("the layout's triggers reach their popups only through the import made on first use", () => {
  for (const file of LIGHT) {
    const source = readFileSync(join(LAYOUT, file), "utf8");
    expect(source, file).not.toMatch(HEAVY);
    expect(source, file).toMatch(
      /import\("@\/components\/layout\/[a-z-]+-popup"\)/,
    );
    expect(source, file).not.toMatch(
      /^import (?!type )[^;]*?from "@\/components\/layout\/[^"]*-popup";/m,
    );
  }
});

test("every popup module has a default export, which is what the trigger loads", () => {
  for (const file of readdirSync(LAYOUT).filter((name) =>
    /-popup\.tsx$/.test(name),
  )) {
    expect(readFileSync(join(LAYOUT, file), "utf8"), file).toMatch(
      /export default function/,
    );
  }
});

const FORUM = join(import.meta.dir, "../forum");

test("a member's name and a mention reach the card only through the import made on first use", () => {
  const CARD =
    /^import (?!type )[^;]*?from "@\/components\/forum\/(member-card-popup|member-card-opened|mention-popup)";/m;
  for (const [file, loaded] of [
    ["member-card-trigger.tsx", "member-card-opened"],
    ["mention-cards.tsx", "mention-popup"],
  ]) {
    const source = readFileSync(join(FORUM, file), "utf8");
    expect(source, file).not.toMatch(HEAVY);
    expect(source, file).not.toMatch(CARD);
    expect(source, file).toContain(`import("@/components/forum/${loaded}")`);
  }
});

test("the postbit's tooltips are plain spans until the pointer comes, and keep their words as the label", () => {
  const html = renderToStaticMarkup(
    <LazyTooltip label="Chrome on Windows" className="x">
      <i />
    </LazyTooltip>,
  );
  expect(html).toBe(
    '<span role="img" data-slot="tooltip-trigger" aria-label="Chrome on Windows" class="x"><i></i></span>',
  );
  for (const file of [
    "award-icon.tsx",
    "client-icons.tsx",
    "user-badges.tsx",
  ]) {
    expect(readFileSync(join(FORUM, file), "utf8"), file).not.toContain(
      "@/components/ui/tooltip",
    );
  }
});

test("a click says how it was made: touch, a mouse or pen press, or a key", () => {
  expect(openedByClick("touch")).toBe("touch");
  expect(openedByClick("mouse")).toBe("pointer");
  expect(openedByClick("pen")).toBe("pointer");
  expect(openedByClick(undefined)).toBe("keyboard");
});

test("a tooltip waits as long as Base UI's own trigger does", () => {
  expect(HOVER_DELAY).toBe(600);
});

test("a menu asked for with a key mounts closed and has the key replayed; any other way it mounts open", () => {
  expect(menuOpening("keyboard", "ArrowDown")).toEqual({
    defaultOpen: false,
    replay: "ArrowDown",
  });
  expect(menuOpening("keyboard", "ArrowUp").replay).toBe("ArrowUp");
  // Enter and Space reach the menu as a click.
  expect(menuOpening("keyboard")).toEqual({
    defaultOpen: false,
    replay: "click",
  });
  expect(menuOpening("pointer")).toEqual({ defaultOpen: true, replay: null });
  expect(menuOpening("touch")).toEqual({ defaultOpen: true, replay: null });
});

test("the two menu popups take the replayed key from the shared hook", () => {
  for (const file of ["guest-menu-popup.tsx", "header-menu-popup.tsx"]) {
    const source = readFileSync(join(LAYOUT, file), "utf8");
    expect(source, file).toContain("useMenuOpening(openedBy, openKey)");
    expect(source, file).toContain("defaultOpen={defaultOpen}");
  }
});
