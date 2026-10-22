import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FormFooter } from "./form-footer";

test("an edit page saves with XenForo's save icon beside the word", () => {
  const html = renderToStaticMarkup(
    <FormFooter
      cancelHref="/back"
      cancel="Cancel"
      submit="Save"
      disabled={false}
    />,
  );
  expect(html).toMatch(
    /<button[^>]*type="submit"[^>]*>.*lucide-save.*<\/svg>Save<\/button>/,
  );
});
