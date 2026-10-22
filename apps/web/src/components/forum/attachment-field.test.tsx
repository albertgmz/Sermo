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

test("the compact field is the labelled Attach files button, last in its row, with the files before it and the size under it", () => {
  const html = render(<AttachmentField compact initial={files} />);
  const button = html.match(/<label class="([^"]*)">(.*?)<\/label>/);
  expect(button?.[2]).toContain(`</svg>${text.attach}<input`);
  expect(button?.[1].split(" ")).toContain("order-last");
  expect(html).toContain('name="attachmentIds" value="4"');
  expect(html.indexOf("plan.pdf")).toBeLessThan(html.indexOf('type="file"'));
  // The size a file may have is a line of its own that ends the row, and the file field names it.
  const note = html.match(/<span id="([^"]*)" class="([^"]*)">([^<]*)<\/span>/);
  expect(note?.[3]).toContain(limit);
  const noteClasses = note?.[2].split(" ") ?? [];
  expect(noteClasses).toContain("order-[10000]");
  expect(noteClasses).toContain("basis-full");
  expect(html).toContain(`aria-describedby="${note?.[1]}"`);
  expect(render(<AttachmentField compact allowed={false} />)).not.toContain(
    limit,
  );
});

test("where files may be added, a picker of pictures waits for the editor's Image button", () => {
  const picker =
    /<input type="file" accept="image\/\*" multiple="" hidden="" tabindex="-1"\/>/;
  expect(render(<AttachmentField compact />)).toMatch(picker);
  expect(render(<AttachmentField />)).toMatch(picker);
  expect(render(<AttachmentField compact allowed={false} />)).not.toMatch(
    picker,
  );
});

test("a picture offers its thumbnail and its full size, any other file one insert button", () => {
  const html = render(
    <AttachmentField
      nodeId={3}
      initial={[
        { id: 4, name: "plan.pdf", size: 2048, type: "application/pdf" },
        { id: 5, name: "cat.png", size: 1024, type: "image/png" },
      ]}
    />,
  );
  // By title: the labels with a file's name in them are filled in by the translator a suite uses.
  const titled = (title: string) => html.split(`title="${title}"`).length - 1;
  expect(titled(text.insert)).toBe(1);
  expect(titled(text.insertThumbnail)).toBe(1);
  expect(titled(text.insertFull)).toBe(1);
});

test("Attach files is XenForo's outline button with its paperclip in a form's own row too", () => {
  const classesOf = (html: string) =>
    html.match(/<label class="([^"]*)">/)?.[1].split(" ") ?? [];
  const row = classesOf(render(<AttachmentField compact />));
  const own = classesOf(render(<AttachmentField />));
  expect(render(<AttachmentField />)).toMatch(
    new RegExp(`lucide-paperclip.*</svg>${text.attach}<input`),
  );
  // The same button, but not pushed to the end of a composer's row.
  expect(own).toEqual(row.filter((name) => name !== "order-last"));
  expect(own).toContain("border");
});
