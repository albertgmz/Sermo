import { afterEach, expect, mock, test } from "bun:test";

// The hook only registers an effect: `useEffect` is replaced by a recorder, so the effect and the
// dependencies it was given can be looked at and run.
type Registered = { effect: () => void; deps: unknown[] };
const registered: Registered[] = [];
const react = await import("react");
mock.module("react", () => ({
  ...react,
  default: react,
  useEffect: (effect: () => void, deps: unknown[]) => {
    registered.push({ effect, deps });
  },
}));
const { useListPlace } = await import("./list-place");

const writes: unknown[][] = [];
class Browser {
  state = { __NA: true };
  replaceState(...args: unknown[]) {
    writes.push(args);
  }
}
const g = globalThis as Record<string, unknown>;
function at(href: string) {
  const url = new URL(href, "http://forum.test");
  g.location = {
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
  };
  g.window = { history: new Browser() };
}
afterEach(() => {
  registered.length = 0;
  writes.length = 0;
  g.location = undefined;
  g.window = undefined;
});

const draw = (over: Partial<Parameters<typeof useListPlace>[0]> = {}) => {
  useListPlace({ count: 2, owed: false, wanted: 1, stamp: 1, ...over });
  return registered[registered.length - 1] as Registered;
};

test("the number of pages loaded goes into the address", () => {
  at("/notifications");
  draw().effect();
  expect(writes).toEqual([[{ __NA: true }, "", "/notifications?pages=2"]]);
});

test("nothing is written before the address has been read, or when it already says so", () => {
  at("/notifications");
  draw({ wanted: null }).effect();
  at("/notifications?pages=2");
  draw().effect();
  expect(writes).toEqual([]);
});

// A refresh of the router (marking an alert read) makes Next write the address it knew, without
// `pages`, over the one written here; the screen is drawn anew with a new stamp, and the place
// must be written again then.
test("a new draw of the screen writes the place again", () => {
  const first = draw({ stamp: 1 });
  const refreshed = draw({ stamp: 2 });
  expect(refreshed.deps).not.toEqual(first.deps);
  at("/notifications");
  first.effect();
  at("/notifications"); // Next wrote its own address over the place
  refreshed.effect();
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual([{ __NA: true }, "", "/notifications?pages=2"]);
});
