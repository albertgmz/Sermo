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

test("the save is the composers' submit: the solid accent button in the accent's foreground", () => {
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
  for (const name of ["bg-primary", "text-primary-foreground"])
    expect(classes).toContain(name);
  expect(classes).not.toContain("bg-primary/10");
});

test("Cancel has the save's size everywhere: 44 px tall, 20 px of padding, a 9 px radius", () => {
  const html = renderToStaticMarkup(
    <FormFooter
      cancelHref="/back"
      cancel="Cancel"
      submit="Save"
      disabled={false}
    />,
  );
  const classes = html.match(/<a[^>]*class="([^"]*)"/)?.[1].split(" ") ?? [];
  for (const name of ["h-11", "px-5", "rounded-[9px]"])
    expect(classes).toContain(name);
  expect(classes).not.toContain("pointer-fine:h-8");
});
