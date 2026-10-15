import { expect, test } from "bun:test";
import { pictureHistory } from "./picture-history";
import { arrowStep, closeAnswer, SWIPE_PX, swipeStep } from "./picture-input";

type State = Record<string, unknown> | null;

// A browser's history reduced to what the viewer uses: a stack of entries (address and state) and a
// place in it, with Next's patch of pushState and replaceState on top (next/dist/client/components/
// app-router.js, Next 16.4). The patch hands the router the new address, which is what
// `useSearchParams` shows, only for a state that is not already Next's own (`__NA` or `_N` set),
// and it writes `__NA` onto the object it was given: a state object the caller keeps and passes
// again is Next's own from the second call on. `routerAddress` is what the router holds.
function browser(start: string) {
  const own = (): State => ({ __NA: true });
  const stack: { url: string; state: State }[] = [{ url: start, state: own() }];
  let at = 0;
  let routerUrl = start;
  const log: string[] = [];
  function patched(data: State, url: string | URL | null | undefined): State {
    if (data?.__NA || data?._N) return data;
    const given: Record<string, unknown> = data ?? {};
    if (stack[at].state?.__NA) given.__NA = stack[at].state?.__NA;
    if (url) routerUrl = String(url);
    return given;
  }
  const history = pictureHistory({
    history: () => ({
      get state() {
        return stack[at].state;
      },
      pushState: (state, _t, url) => {
        const kept = structuredClone(patched(state, url));
        stack.splice(at + 1, stack.length, { url: String(url), state: kept });
        at += 1;
        log.push("push");
      },
      replaceState: (state, _t, url) => {
        stack[at] = {
          url: String(url),
          state: structuredClone(patched(state, url)),
        };
        log.push("replace");
      },
      back: () => {
        at = Math.max(0, at - 1);
        routerUrl = stack[at].url;
        log.push("back");
      },
    }),
    here: () => stack[at].url,
  });
  return {
    history,
    log,
    address: () => stack[at].url,
    routerAddress: () => routerUrl,
    // What the browser does on its own Back button.
    back: () => {
      at = Math.max(0, at - 1);
      routerUrl = stack[at].url;
    },
    // A navigation to another page (the "where" link): a new entry with no mark.
    visit: (url: string) => {
      stack.splice(at + 1, stack.length, { url, state: own() });
      at += 1;
      routerUrl = url;
    },
    // What the router does to an entry when it rewrites the address (the list's `pages`): the state
    // is not kept.
    rewrite: (url: string) => {
      stack[at] = { url, state: own() };
      routerUrl = url;
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

test("open, step, step, close and open again: the router follows every address", () => {
  const b = browser("/?tab=media&pages=2");
  const synced = () => expect(b.routerAddress()).toBe(b.address());
  b.history.open(ref(5));
  synced();
  expect(b.routerAddress()).toBe("/?tab=media&pages=2&picture=post-5-7");
  b.history.change(ref(6));
  synced();
  expect(b.routerAddress()).toBe("/?tab=media&pages=2&picture=post-6-7");
  b.history.change(ref(7));
  synced();
  expect(b.routerAddress()).toBe("/?tab=media&pages=2&picture=post-7-7");
  b.history.close();
  synced();
  expect(b.routerAddress()).toBe("/?tab=media&pages=2");
  b.history.open(ref(8));
  synced();
  expect(b.routerAddress()).toBe("/?tab=media&pages=2&picture=post-8-7");
  b.history.close();
  synced();
  expect(b.routerAddress()).toBe("/?tab=media&pages=2");
});

test("closing an entry a link made is followed by the router too", () => {
  const b = browser("/?tab=media&picture=post-5-7");
  b.history.close();
  expect(b.routerAddress()).toBe("/?tab=media");
  expect(b.address()).toBe("/?tab=media");
});

test("a second press while a picture is open adds no second entry", () => {
  const b = browser("/?tab=media");
  b.history.open(ref(5));
  b.history.open(ref(6));
  expect(b.address()).toBe("/?tab=media&picture=post-5-7");
  expect(b.log).toEqual(["push"]);
  b.history.close();
  expect(b.address()).toBe("/?tab=media");
});
