import { expect, test } from "bun:test";
import { pictureHistory } from "./picture-history";
import { arrowStep, closeAnswer, SWIPE_PX, swipeStep } from "./picture-input";

// A browser's history reduced to what the viewer uses: a stack of addresses and a place in it.
function browser(start: string) {
  const stack = [start];
  let at = 0;
  const log: string[] = [];
  const history = pictureHistory({
    history: () => ({
      pushState: (_s, _t, url) => {
        stack.splice(at + 1, stack.length, String(url));
        at += 1;
        log.push("push");
      },
      replaceState: (_s, _t, url) => {
        stack[at] = String(url);
        log.push("replace");
      },
      back: () => {
        at = Math.max(0, at - 1);
        log.push("back");
      },
    }),
    here: () => stack[at],
  });
  return {
    history,
    log,
    address: () => stack[at],
    // What the browser does on its own Back button.
    back: () => {
      at = Math.max(0, at - 1);
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

test("after Back closed it the next close is not a Back", () => {
  const b = browser("/?tab=media");
  b.history.open(ref(5));
  b.back();
  b.history.left();
  b.history.close();
  expect(b.log.at(-1)).toBe("replace");
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
