import { expect, test } from "bun:test";
import { OPENSEARCH_URL, openSearchDescription } from "./opensearch";

const origin = "https://forum.example";

test("the description sends a search to the results page and names itself", () => {
  const xml = openSearchDescription(
    { name: "Garden Club", description: "A club for gardeners." },
    origin,
  );
  expect(xml).toStartWith('<?xml version="1.0" encoding="UTF-8"?>');
  expect(xml).toContain(
    '<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">',
  );
  expect(xml).toContain("<ShortName>Garden Club</ShortName>");
  expect(xml).toContain("<Description>A club for gardeners.</Description>");
  expect(xml).toContain(
    '<Url type="text/html" method="get" template="https://forum.example/search?q={searchTerms}"/>',
  );
  expect(xml).toContain(
    `rel="self" template="https://forum.example${OPENSEARCH_URL}"`,
  );
});

test("a long name is shortened to fit, and the text is escaped", () => {
  const xml = openSearchDescription(
    { name: "Gardeners & Growers Worldwide", description: "" },
    origin,
  );
  const short = /<ShortName>(.*)<\/ShortName>/.exec(xml)?.[1] ?? "";
  expect(short.length).toBeLessThanOrEqual(16);
  expect(xml).toContain(
    "<Description>Gardeners &#38; Growers Worldwide</Description>",
  );
  expect(xml).not.toMatch(/&(?!#\d+;)/);
});
