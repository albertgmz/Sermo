import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import { ThreadBatch, ThreadTick } from "./thread-batch";

const action = async () => ({});
const draw = (actions: Parameters<typeof ThreadBatch>[0]["actions"]) =>
  renderToStaticMarkup(
    withIntl(
      <ThreadBatch action={action} actions={actions} forums={[]} prefixes={[]}>
        <ThreadTick id={7} title="A thread" />
      </ThreadBatch>,
    ),
  );

test("a viewer with batch changes can tick a thread, and the bar waits for a tick", () => {
  const html = draw(["lock"]);
  expect(html).toContain("Select thread A thread");
  expect(html).not.toContain("<form");
});

test("a viewer with no batch change gets no tick at all", () => {
  expect(draw([])).not.toContain("Select thread");
  expect(
    renderToStaticMarkup(withIntl(<ThreadTick id={7} title="A thread" />)),
  ).toBe("");
});
