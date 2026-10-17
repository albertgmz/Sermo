import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import { Advanced, EditForm, Field, FieldGroup } from "./edit-form";
import { FieldErrors } from "./form-rows";

const action = async () => null;

const render = (node: React.ReactNode) => renderToStaticMarkup(withIntl(node));

test("groups of fields in fieldsets, the advanced options closed, one save bar at the end", () => {
  const html = render(
    <EditForm action={action} submit="Save reaction">
      <FieldGroup legend="Basics" description="What members see.">
        <Field
          name="title"
          label="Title"
          htmlFor="title"
          help="Shown on hover."
        >
          <input id="title" name="title" />
        </Field>
      </FieldGroup>
      <Advanced>
        <Field name="frames" label="Frames" htmlFor="frames">
          <input id="frames" name="frames" />
        </Field>
      </Advanced>
    </EditForm>,
  );
  expect(html).toContain("<form");
  expect(html).toContain("<legend");
  expect(html).toContain("Basics");
  expect(html).toContain("What members see.");
  expect(html).toContain('<label id="title-label" for="title"');
  expect(html).toContain('id="title-help"');
  expect(html).toContain("Shown on hover.");
  // Label and help to the left from 768 px, stacked below it.
  expect(html).toContain("md:grid-cols-[16rem_minmax(0,1fr)]");
  expect(html).toContain("<details");
  expect(html).not.toContain("<details open");
  expect(html).toContain("Advanced options");
  expect(html).toContain('name="frames"');
  // The save bar comes after every group.
  expect(html.lastIndexOf('type="submit"')).toBeGreaterThan(
    html.indexOf('name="frames"'),
  );
  expect(html).toContain("Save reaction");
});

test("a field shows its error, and the advanced options open when one of theirs has one", () => {
  const html = render(
    <FieldErrors value={{ frames: "Enter a whole number." }}>
      <Advanced label="Sprite" fields={["frames"]}>
        <Field name="frames" label="Frames" htmlFor="frames">
          <input id="frames" name="frames" />
        </Field>
      </Advanced>
      <Advanced fields={["other"]}>
        <Field name="other" label="Other">
          <input name="other" />
        </Field>
      </Advanced>
    </FieldErrors>,
  );
  expect(html).toContain("<details open");
  expect(html.match(/<details open/g)?.length).toBe(1);
  expect(html).toContain("Sprite");
  expect(html).toContain('id="frames-error"');
  expect(html).toContain("Enter a whole number.");
});

test("a disabled form disables its fields and its save button", () => {
  const html = render(
    <EditForm action={action} disabled>
      <FieldGroup legend="Basics">
        <Field name="title" label="Title" htmlFor="title">
          <input id="title" name="title" />
        </Field>
      </FieldGroup>
    </EditForm>,
  );
  expect(html).toMatch(/<fieldset disabled=""/);
  expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  expect(html).toContain("Save changes");
});
