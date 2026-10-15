import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createOpener, fetchCode, loadedCode } from "./lazy-popup-gate";
import { hovers, isPlainClick, opensFromKey } from "./lazy-popup-intent";
import { LazyPopup } from "./lazy-popup";

const click = {
  button: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
};

function deferred() {
  let resolve!: (value: { default: string }) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<{ default: string }>((ok, no) => {
    resolve = ok;
    reject = no;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((done) => setTimeout(done, 0));

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

test("the code is fetched once however many triggers ask, and warming opens nothing", async () => {
  let fetched = 0;
  const load = async () => {
    fetched += 1;
    return { default: "popup" };
  };
  let shown = 0;
  const a = createOpener(
    load,
    () => shown++,
    () => {},
  );
  const b = createOpener(
    load,
    () => shown++,
    () => {},
  );
  a.warm();
  b.warm();
  a.warm();
  await tick();
  expect(fetched).toBe(1);
  expect(shown).toBe(0);
  expect(loadedCode(load)).toBe("popup");
});

test("a click before the code arrives opens as soon as it does, and one after opens at once", async () => {
  const slow = deferred();
  const load = () => slow.promise;
  let shown = 0;
  const opener = createOpener(
    load,
    () => shown++,
    () => {},
  );
  opener.open();
  expect(shown).toBe(0);
  slow.resolve({ default: "popup" });
  await tick();
  expect(shown).toBe(1);
  opener.open();
  expect(shown).toBe(2);
});

test("a hover that ends before the code arrives opens nothing", async () => {
  const slow = deferred();
  const load = () => slow.promise;
  let shown = 0;
  const opener = createOpener(
    load,
    () => shown++,
    () => {},
  );
  opener.open();
  opener.cancel();
  slow.resolve({ default: "popup" });
  await tick();
  expect(shown).toBe(0);
});

test("a failed fetch is reported, forgotten and tried again by the next gesture", async () => {
  let attempts = 0;
  const load = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("offline");
    return { default: "popup" };
  };
  let shown = 0;
  let failures = 0;
  const opener = createOpener(
    load,
    () => shown++,
    () => failures++,
  );
  opener.open();
  await tick();
  expect([shown, failures, loadedCode(load)]).toEqual([0, 1, undefined]);
  opener.open();
  await tick();
  expect([attempts, shown, failures]).toEqual([2, 1, 1]);
  await fetchCode(load);
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
