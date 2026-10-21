import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { withIntl } from "@/lib/test-intl";
import { AttachmentField } from "./attachment-field";
import { ComposerButtons } from "./composer-buttons";

const attach = messages.forum.attachmentField.attach;

const draw = (props: Partial<React.ComponentProps<typeof ComposerButtons>>) =>
  renderToStaticMarkup(
    withIntl(
      <ComposerButtons
        submitLabel="Responder"
        order="reply"
        files={<AttachmentField compact />}
        {...props}
      />,
    ),
  );

const submitOf = (html: string) =>
  html.match(/<button[^>]*type="submit"[^>]*>(.*?)<\/button>/);
const classesOf = (tag: string) =>
  tag.match(/class="([^"]*)"/)?.[1].split(" ") ?? [];

test("the submit says what it does, beside a reply icon, and Attach files says it too", () => {
  const html = draw({});
  const submit = submitOf(html);
  expect(submit?.[1]).toMatch(/<svg[^>]*lucide-reply[^>]*>.*<\/svg>Responder$/);
  expect(html).toContain(`</svg>${attach}<input`);
});

test("a reply puts Attach files first and the submit at the end; a comment the submit first", () => {
  // Both buttons are flex items of one row; `order-last` takes a button to its end, after the
  // files, in the order of the page.
  const reply = draw({ order: "reply" });
  const comment = draw({ order: "comment" });
  const label = (html: string) => html.match(/<label[^>]*>/)?.[0] ?? "";
  for (const html of [reply, comment]) {
    expect(classesOf(label(html))).toContain("order-last");
    expect(html.indexOf("<label")).toBeLessThan(html.indexOf('type="submit"'));
  }
  const replySubmit = classesOf(submitOf(reply)?.[0] ?? "");
  expect(replySubmit).toContain("order-last");
  expect(replySubmit).toContain("ml-auto");
  const commentSubmit = classesOf(submitOf(comment)?.[0] ?? "");
  expect(commentSubmit).not.toContain("order-last");
  expect(commentSubmit).not.toContain("ml-auto");
});

test("both buttons are touch targets on a touch screen and XenForo's quieter size under a mouse", () => {
  const html = draw({});
  for (const tag of [
    submitOf(html)?.[0] ?? "",
    html.match(/<label[^>]*>/)?.[0] ?? "",
  ]) {
    expect(classesOf(tag)).toContain("h-11");
    expect(classesOf(tag)).toContain("pointer-fine:h-8");
  }
});

test("the submit waits while a file is on its way", () => {
  expect(submitOf(draw({ disabled: true }))?.[0]).toContain('disabled=""');
  expect(submitOf(draw({}))?.[0]).not.toContain('disabled=""');
});

test("the submit is a soft tint of the accent, its text in the accent's ink", () => {
  const classes = classesOf(submitOf(draw({}))?.[0] ?? "");
  expect(classes).toContain("bg-primary/10");
  expect(classes).toContain("text-primary-ink");
  expect(classes).not.toContain("text-primary");
  expect(classes).not.toContain("bg-primary");
});

test("a composer with no files has the submit alone", () => {
  const html = draw({ files: undefined });
  expect(html).not.toContain(attach);
  expect(submitOf(html)).not.toBeNull();
});
