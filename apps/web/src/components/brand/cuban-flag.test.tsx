import { expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));

const { CubanFlag } = await import("./cuban-flag");

// Rendered to the end: the flag waits for the visitor's LITE choice behind a boundary.
const stream = await renderToReadableStream(<CubanFlag />);
await stream.allReady;
const markup = (await new Response(stream).text()).replace(
  /^<!--\$-->|<!--\/\$-->$/g,
  "",
);

// The points of the polygon drawn in `colour`, as [x, y] pairs.
function polygon(colour: string) {
  const found = markup.match(
    new RegExp(`<polygon[^>]*points="([^"]+)"[^>]*fill-flag-${colour}`),
  )?.[1];
  return (found ?? "")
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(",").map(Number) as [number, number]);
}

const distance = ([ax, ay]: number[], [bx, by]: number[]) =>
  Math.hypot((ax ?? 0) - (bx ?? 0), (ay ?? 0) - (by ?? 0));

test("the flag is decoration, hidden from assistive technology", () => {
  expect(markup).toMatch(/^<span[^>]*aria-hidden="true"/);
  expect(markup).not.toMatch(/<title|aria-label|role="img"/);
});

test("the flag keeps its proportions: five equal stripes, an equilateral red triangle at the hoist, the star at its centre", () => {
  expect(markup).toContain('viewBox="0 0 30 15"');
  // Blue ground, white stripes two and four: five stripes of 3 units on a 15-unit hoist.
  expect(markup).toMatch(/<rect width="30" height="15" class="fill-flag-blue"/);
  expect(
    [
      ...markup.matchAll(
        /<rect y="(\d+)" width="30" height="3" class="fill-flag-white"/g,
      ),
    ].map((match) => Number(match[1])),
  ).toEqual([3, 9]);
  const triangle = polygon("red");
  expect(triangle).toHaveLength(3);
  const [top = [], tip = [], bottom = []] = triangle;
  expect(top).toEqual([0, 0]);
  expect(bottom).toEqual([0, 15]);
  expect(distance(top, tip)).toBeCloseTo(15, 2);
  expect(distance(tip, bottom)).toBeCloseTo(15, 2);
  const star = polygon("white");
  expect(star).toHaveLength(10);
  const centre = [(0 + (tip[0] ?? 0) + 0) / 3, 7.5];
  const outer = star.filter((_, index) => index % 2 === 0);
  for (const point of outer)
    expect(distance(point, centre)).toBeCloseTo(2.5, 2);
  // The first point is straight up.
  expect(outer[0]?.[0]).toBeCloseTo(centre[0] ?? 0, 2);
});
