import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { withIntl } from "@/lib/test-intl";
import { AttachmentField } from "./attachment-field";
import { UploadLimitProvider } from "./upload-limit";

const text = messages.forum.attachmentField;
// The words after the number: other suites replace the translator with one that fills in nothing.
const limit = text.limit.split("{size}")[1];
const files = [{ id: 4, name: "plan.pdf", size: 2048 }];

const render = (field: React.ReactNode) =>
  renderToStaticMarkup(
    withIntl(
      <UploadLimitProvider bytes={5 * 1024 * 1024}>
        {field}
      </UploadLimitProvider>,
    ),
  );

test("the field names its files for the form and says the size a file may have", () => {
  const html = render(<AttachmentField nodeId={3} initial={files} />);
  expect(html).toContain('name="attachments" value="listed"');
  expect(html).toContain('name="attachmentIds" value="4"');
  expect(html).toContain("plan.pdf");
  expect(html).toContain(limit);
});

test("the compact field is the paperclip alone, with the files on a line before it", () => {
  const html = render(<AttachmentField compact initial={files} />);
  expect(html).toContain(`<span class="sr-only">${text.attach}</span>`);
  expect(html).not.toContain(limit);
  expect(html).toContain('name="attachmentIds" value="4"');
  expect(html.indexOf("plan.pdf")).toBeLessThan(html.indexOf('type="file"'));
});
