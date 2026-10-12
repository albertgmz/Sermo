import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import { ConfirmStep } from "./confirm-step";

const action = async () => null;

test("the step is closed, carries its hidden fields and shows the button only inside", () => {
  const html = renderToStaticMarkup(
    <ConfirmStep
      action={action}
      fields={{ id: 7, which: "avatar" }}
      summary="Remove"
      warning="This cannot be undone."
      submit="Remove it"
    />,
  );
  expect(html).toContain("<details");
  expect(html).not.toContain("<details open");
  expect(html).toContain('<input type="hidden" name="id" value="7"/>');
  expect(html).toContain('name="which"');
  expect(html).toContain("This cannot be undone.");
  expect(html).toContain("Remove it");
});

test("a reason field, the administrator's password and a panel heading are optional", () => {
  const plain = renderToStaticMarkup(
    <ConfirmStep action={action} summary="Lift" />,
  );
  expect(plain).not.toContain('name="reason"');
  expect(plain).not.toContain("actorPassword");
  const full = renderToStaticMarkup(
    withIntl(
      <ConfirmStep
        action={action}
        fields={{ id: 3 }}
        heading="Delete this"
        submit="Delete"
        reason="Why"
        password
      />,
    ),
  );
  expect(full).toContain('name="reason"');
  expect(full).toContain('name="actorPassword"');
  expect(full).toContain("Delete this");
  // With a heading and no summary the block opens with "<submit>…".
  expect(full).toContain("Delete…");
});
