import { expect, test } from "bun:test";
import { reserveBannerSpace } from "./space";

function fakes(height: number) {
  const values = new Map<string, string>();
  const root = {
    style: {
      setProperty: (name: string, value: string) => values.set(name, value),
      removeProperty: (name: string) => values.delete(name),
    },
  } as unknown as HTMLElement;
  let tall = height;
  const banner = {
    getBoundingClientRect: () => ({ height: tall }),
  } as unknown as Element;
  let run: () => void = () => {};
  let watching = false;
  const watch = (callback: () => void) => {
    run = callback;
    return {
      observe: () => {
        watching = true;
      },
      disconnect: () => {
        watching = false;
      },
    };
  };
  return {
    values,
    root,
    banner,
    watch,
    resize: (next: number) => {
      tall = next;
      run();
    },
    watching: () => watching,
  };
}

test("the page keeps room as tall as the banner, follows its height and gives the room back", () => {
  const w = fakes(330);
  const release = reserveBannerSpace(w.root, w.banner, w.watch);
  expect(w.values.get("--consent-space")).toBe("330px");
  expect(w.watching()).toBe(true);
  w.resize(280);
  expect(w.values.get("--consent-space")).toBe("280px");
  release();
  expect(w.values.has("--consent-space")).toBe(false);
  expect(w.watching()).toBe(false);
});
