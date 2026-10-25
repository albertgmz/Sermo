import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { creditRulesBody } from "@/lib/test-bodies";
import { withIntl } from "@/lib/test-intl";
import { RuleFields } from "./rule-fields";

const nodes = [{ id: 3, title: "General", depth: 0 }];
const { triggers } = creditRulesBody([], ["reply_posted"]) as {
  triggers: Parameters<typeof RuleFields>[0]["triggerChoices"];
};

function html(
  choices: typeof triggers,
  fixedTrigger?: (typeof triggers)[number]["id"],
) {
  return renderToStaticMarkup(
    withIntl(
      <RuleFields
        idPrefix="t"
        fixedTrigger={fixedTrigger}
        triggerChoices={choices}
        nodes={nodes}
        chosen={[]}
      />,
    ),
  );
}

test("the trigger select lists the triggers the backend lists, in its order", () => {
  const page = html(triggers);
  const options = [...page.matchAll(/<option value="([^"]+)"/g)].map(
    (match) => match[1],
  );
  expect(options).toEqual(triggers.map((trigger) => trigger.id));
});

test("the forum picker shows only for a trigger that accepts forums", () => {
  // The picker is a list of checkboxes named for the forums.
  const picker = 'name="nodeIds"';
  // The first trigger of the answer is the one chosen at first.
  expect(html(triggers)).not.toContain(picker);
  const first = triggers.find((trigger) => trigger.acceptsForums);
  if (!first) throw new Error("no trigger takes forums");
  expect(html([first, ...triggers.filter((t) => t !== first)])).toContain(
    picker,
  );
  expect(html(triggers, first.id)).toContain(picker);
});

test("the filter fields show only for a trigger that accepts filters, holding the rule's values", () => {
  const fields = [
    'name="createdFrom"',
    'name="createdUntil"',
    'name="minLength"',
    'name="maxLength"',
  ];
  const filterable = { ...triggers[0], acceptsFilters: true };
  const plain = { ...triggers[1], acceptsFilters: false };
  for (const field of fields) {
    expect(html([plain])).not.toContain(field);
    expect(html([filterable])).toContain(field);
  }
  const filled = renderToStaticMarkup(
    withIntl(
      <RuleFields
        idPrefix="t"
        fixedTrigger={filterable.id}
        triggerChoices={[filterable]}
        nodes={nodes}
        chosen={[]}
        filters={{
          createdFrom: "2020-01-01",
          createdUntil: null,
          minLength: 20,
          maxLength: null,
        }}
      />,
    ),
  );
  expect(filled).toMatch(/name="createdFrom"[^>]*value="2020-01-01"/);
  expect(filled).toMatch(/name="minLength"[^>]*value="20"/);
  expect(filled).not.toMatch(/name="createdUntil"[^>]*value=/);
});
