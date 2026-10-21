import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  anchorIn,
  EarlierComments,
  type EarlierPage,
  merged,
  workQueue,
} from "./earlier-comments";

const row = (id: number, text = String(id)) => ({ id, node: text });

test("the rows of both are each comment once, oldest first, and a later row replaces its older copy", () => {
  expect(
    merged([row(5), row(9, "old nine")], [row(2), row(9, "new nine"), row(7)]),
  ).toEqual([row(2), row(5), row(7), row(9, "new nine")]);
  expect(merged([], [])).toEqual([]);
});

test("work runs one piece after the other, each starting from what the one before left", async () => {
  const enqueue = workQueue();
  const order: string[] = [];
  const slow = enqueue(async () => {
    order.push("a starts");
    await new Promise((resolve) => setTimeout(resolve, 20));
    order.push("a ends");
  });
  const fast = enqueue(async () => {
    order.push("b starts");
  });
  await Promise.all([slow, fast]);
  expect(order).toEqual(["a starts", "a ends", "b starts"]);
});

test("a piece that fails does not stop the line", async () => {
  const enqueue = workQueue();
  const order: string[] = [];
  await enqueue(async () => {
    throw new Error("network");
  });
  await enqueue(async () => {
    order.push("next");
  });
  expect(order).toEqual(["next"]);
});

// A list of comments at the given tops and heights, as the DOM answers for them.
function list(rows: { top: number; height: number }[]) {
  const elements = rows.map(({ top, height }) => ({
    getBoundingClientRect: () => ({ top, bottom: top + height }),
  }));
  return {
    elements,
    list: { querySelectorAll: () => elements } as unknown as Element,
  };
}

test("the comment held is the first one still on the screen, with where it is", () => {
  const { elements, list: dom } = list([
    { top: -300, height: 100 },
    { top: -50, height: 200 },
    { top: 150, height: 100 },
  ]);
  expect(anchorIn(dom, 800)).toEqual({ element: elements[1], top: -50 });
});

test("a list all above the screen holds its first comment", () => {
  const { elements, list: dom } = list([
    { top: -900, height: 100 },
    { top: -700, height: 100 },
  ]);
  expect(anchorIn(dom, 800)).toEqual({ element: elements[0], top: -900 });
});

test("no comment is held when the first one still on the screen is below it", () => {
  const { list: dom } = list([
    { top: 1200, height: 100 },
    { top: 1400, height: 100 },
  ]);
  expect(anchorIn(dom, 800)).toBeNull();
  expect(anchorIn(list([{ top: 800, height: 10 }]).list, 800)).toBeNull();
  expect(anchorIn(list([{ top: 799, height: 10 }]).list, 800)).not.toBeNull();
});

test("an empty or missing list holds nothing", () => {
  expect(anchorIn(list([]).list, 800)).toBeNull();
  expect(anchorIn(null, 800)).toBeNull();
});

test("before any press the button is drawn, and no comment", () => {
  const load = async (): Promise<EarlierPage> => ({
    rows: [],
    cursor: null,
    done: true,
  });
  const html = renderToStaticMarkup(
    <EarlierComments
      load={load}
      shown={[]}
      label="Show more comments"
      className="x"
    />,
  );
  expect(html).toContain("Show more comments");
  expect(html).toContain('class="x"');
});
