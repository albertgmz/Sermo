import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LazyMemberPickerField } from "./lazy-member-picker-field";

const text = {
  placeholder: "Find",
  noMatch: "None",
  chosen: "Chosen",
  remove: "Remove {name}",
};

test("until the picker's code has loaded, the field is a plain labelled box that sends what is typed", () => {
  const html = renderToStaticMarkup(
    <LazyMemberPickerField
      name="author"
      label="By member"
      initial="ember"
      text={text}
    />,
  );
  const forId = html.match(/<label[^>]*for="([^"]+)"[^>]*>By member<\/label>/);
  const box = html.match(/<input[^>]*name="author"[^>]*>/)?.[0] ?? "";
  expect(forId?.[1]).toBeTruthy();
  expect(box).toContain(`id="${forId?.[1]}"`);
  expect(box).toContain('value="ember"');
});
