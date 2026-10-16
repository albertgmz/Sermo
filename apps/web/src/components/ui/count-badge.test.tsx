import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { badgeText, CountBadge } from "./count-badge";

const render = (count: number) =>
  renderToStaticMarkup(<CountBadge count={count} />);

test("a count reads 1 to 99 as it is and anything above as 99+", () => {
  expect(badgeText(1)).toBe("1");
  expect(badgeText(99)).toBe("99");
  expect(badgeText(100)).toBe("99+");
  expect(badgeText(2500)).toBe("99+");
});

test("nothing is drawn for no count", () => {
  expect(render(0)).toBe("");
});

test("the badge shows the number for the eye only: the control it sits on says it", () => {
  for (const [count, text] of [
    [1, "1"],
    [99, "99"],
    [100, "99+"],
  ] as const) {
    const html = render(count);
    expect(html.startsWith('<span aria-hidden="true"')).toBe(true);
    expect(html.endsWith(`>${text}</span>`)).toBe(true);
  }
});
