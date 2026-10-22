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

test("the save is the composers' submit: the accent's soft tint, edged by a faint line of it, in its ink", () => {
  const html = renderToStaticMarkup(
    <FormFooter
      cancelHref="/back"
      cancel="Cancel"
      submit="Save"
      disabled={false}
    />,
  );
  const classes =
    html
      .match(/<button[^>]*type="submit"[^>]*class="([^"]*)"/)?.[1]
      .split(" ") ??
    html
      .match(/<button[^>]*class="([^"]*)"[^>]*type="submit"/)?.[1]
      .split(" ") ??
    [];
  for (const name of ["bg-primary/10", "border-primary/30", "text-primary-ink"])
    expect(classes).toContain(name);
  expect(classes).not.toContain("bg-primary");
});
