import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import { TermsField } from "./account-fields";

test("the terms box can open its pages in a new tab, so the form beside it keeps what was typed", () => {
  const html = renderToStaticMarkup(
    withIntl(<TermsField pages="both" newTab />),
  );
  for (const page of ["/terms", "/rules", "/privacy"])
    expect(html).toMatch(
      new RegExp(`<a(?=[^>]*target="_blank")(?=[^>]*href="${page}")`),
    );
  // Screen readers hear it too, in each link.
  expect(
    html.match(/<span class="sr-only"> \(opens in a new tab\)<\/span><\/a>/g),
  ).toHaveLength(3);
  const same = renderToStaticMarkup(withIntl(<TermsField pages="both" />));
  expect(same).not.toContain("_blank");
  expect(same).not.toContain("new tab");
});
