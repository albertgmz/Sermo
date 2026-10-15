import { expect, test } from "bun:test";
import { pictureHistory } from "./picture-history";
import { arrowStep, closeAnswer, SWIPE_PX, swipeStep } from "./picture-input";

// A browser's history reduced to what the viewer uses: a stack of entries (address and state) and a
// place in it. Like a browser, each entry keeps its own state.
function browser(start: string) {
  const stack: { url: string; state: unknown }[] = [
    { url: start, state: null },
  ];
  let at = 0;
  const log: string[] = [];
  const history = pictureHistory({
    history: () => ({
      get state() {
        return stack[at].state;
      },
      pushState: (state, _t, url) => {
        stack.splice(at + 1, stack.length, { url: String(url), state });
        at += 1;
        log.push("push");
      },
      replaceState: (state, _t, url) => {
        stack[at] = { url: String(url), state };
        log.push("replace");
      },
      back: () => {
        at = Math.max(0, at - 1);
        log.push("back");
      },
    }),
    here: () => stack[at].url,
  });
  return {
    history,
    log,
    address: () => stack[at].url,
    // What the browser does on its own Back button.
    back: () => {
      at = Math.max(0, at - 1);
    },
    // A navigation to another page (the "where" link): a new entry with no mark.
    visit: (url: string) => {
      stack.splice(at + 1, stack.length, { url, state: null });
      at += 1;
    },
    // What the router does to an entry when it rewrites the address (the list's `pages`): the state
    // is not kept.
    rewrite: (url: string) => {
      stack[at] = { url, state: null };
    },
    entries: () => stack.length,
  };
}

const ref = (contentId: number) =>
  ({ kind: "post", contentId, fileId: 7 }) as const;

test("opening a picture adds an entry to the address, and the list's own address is kept", () => {
  const b = browser("/?tab=media&pages=2");
  b.history.open(ref(5));
  expect(b.address()).toBe("/?tab=media&pages=2&picture=post-5-7");
  expect(b.entries()).toBe(2);
});

test("stepping to another picture replaces the entry, so one Back leaves the viewer", () => {
  const b = browser("/?tab=media");
  b.history.open(ref(5));
  b.history.change(ref(6));
  b.history.change(ref(7));
  expect(b.address()).toBe("/?tab=media&picture=post-7-7");
  expect(b.entries()).toBe(2);
  b.back();
  expect(b.address()).toBe("/?tab=media");
});

test("closing a viewer this list opened goes back and leaves no entry behind", () => {
  const b = browser("/?tab=media");
  b.history.open(ref(5));
  b.history.change(ref(6));
  b.history.close();
  expect(b.log.at(-1)).toBe("back");
  expect(b.address()).toBe("/?tab=media");
});

test("closing a viewer a link opened takes the picture out in place", () => {
  const b = browser("/?tab=media&picture=post-5-7");
  b.history.close();
  expect(b.log).toEqual(["replace"]);
  expect(b.address()).toBe("/?tab=media");
  expect(b.entries()).toBe(1);
});

test("opening the post from the viewer and coming Back still closes without a second entry", () => {
  const b = browser("/?tab=media");
  b.history.open(ref(5));
  b.visit("/threads/7#post-31");
  b.back();
  expect(b.address()).toBe("/?tab=media&picture=post-5-7");
  b.history.close();
  expect(b.log.at(-1)).toBe("back");
  expect(b.address()).toBe("/?tab=media");
});

test("an entry that lost its mark is closed in place, which is the safe way", () => {
  const b = browser("/?tab=media");
  b.history.open(ref(5));
  b.rewrite("/?tab=media&picture=post-5-7&pages=2");
  b.history.close();
  expect(b.log.at(-1)).toBe("replace");
  expect(b.address()).toBe("/?tab=media&pages=2");
});

test("stepping keeps the mark, so a close after it still goes back", () => {
  const b = browser("/?tab=media");
  b.history.open(ref(5));
  b.history.change(ref(6));
  b.history.change(ref(7));
  b.history.close();
  expect(b.log.at(-1)).toBe("back");
});

test("arrow keys step, unless a modifier is down or a field has the key", () => {
  expect(arrowStep("ArrowRight", false, false)).toBe("next");
  expect(arrowStep("ArrowLeft", false, false)).toBe("previous");
  expect(arrowStep("ArrowRight", true, false)).toBeNull();
  expect(arrowStep("ArrowLeft", false, true)).toBeNull();
  expect(arrowStep("Escape", false, false)).toBeNull();
});

test("a swipe steps when it is long enough and more across than down", () => {
  expect(swipeStep(-SWIPE_PX, 0)).toBe("next");
  expect(swipeStep(SWIPE_PX, 10)).toBe("previous");
  expect(swipeStep(SWIPE_PX - 1, 0)).toBeNull();
  // A scroll that drifted sideways is not a swipe.
  expect(swipeStep(-60, 60)).toBeNull();
});

test("only the close button, and Esc with nothing on top, close the viewer", () => {
  expect(closeAnswer("close-press", false, false)).toBe("close");
  expect(closeAnswer("escape-key", false, false)).toBe("close");
  // Esc meant for a mention list that handled it, or for an open reaction picker or list.
  expect(closeAnswer("escape-key", true, false)).toBe("keep");
  expect(closeAnswer("escape-key", false, true)).toBe("keep");
  // A press or focus in a popup drawn outside the viewer never closes it.
  expect(closeAnswer("outside-press", false, false)).toBe("keep");
  expect(closeAnswer("focus-out", false, false)).toBe("keep");
});
