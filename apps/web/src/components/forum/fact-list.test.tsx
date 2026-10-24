import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Fact, FactList } from "./fact-list";

const html = renderToStaticMarkup(
  <FactList>
    <Fact label="Latest member">wren-with-a-rather-long-name</Fact>
    <Fact label="Members">4</Fact>
  </FactList>,
);

test("a fact is a label and its value on one row, both read in full", () => {
  expect(html).toContain("<dt");
  expect(html).toContain(">Latest member</dt>");
  expect(html).toContain(">wren-with-a-rather-long-name</dd>");
  expect(html.match(/<dd/g)).toHaveLength(2);
});

test("the value is never cut short with an ellipsis: it keeps its room and a very long one wraps", () => {
  const value = /<dd class="([^"]*)"/.exec(html)?.[1] ?? "";
  expect(value).not.toContain("truncate");
  expect(value).toContain("[overflow-wrap:anywhere]");
  const label = /<dt class="([^"]*)"/.exec(html)?.[1] ?? "";
  expect(label).toContain("shrink-0");
});
