import { expect, test } from "bun:test";
import { MessagesSquare, SquarePen } from "lucide-react";
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

test("both buttons have XenForo's size everywhere: 44 px tall, 20 px of padding, a 9 px radius, 13 px text", () => {
  const html = draw({});
  for (const tag of [
    submitOf(html)?.[0] ?? "",
    html.match(/<label[^>]*>/)?.[0] ?? "",
  ]) {
    for (const name of [
      "h-11",
      "px-5",
      "rounded-[9px]",
      "text-(length:--text-compact)",
    ])
      expect(classesOf(tag)).toContain(name);
    expect(classesOf(tag)).not.toContain("pointer-fine:h-8");
  }
  // Attach files is filled with the card and edged with the border colour, in both themes.
  const label = classesOf(html.match(/<label[^>]*>/)?.[0] ?? "");
  for (const name of [
    "bg-card",
    "border-border",
    "dark:bg-card",
    "dark:border-border",
  ])
    expect(label).toContain(name);
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

test("the submit's icon says what it does, as XenForo's: a reply unless the composer names another", () => {
  expect(submitOf(draw({}))?.[1]).toContain("lucide-reply");
  const thread = submitOf(draw({ icon: SquarePen }))?.[1] ?? "";
  expect(thread).toContain("lucide-square-pen");
  expect(thread).not.toContain("lucide-reply");
  expect(submitOf(draw({ icon: MessagesSquare }))?.[1]).toContain(
    "lucide-messages-square",
  );
});

test("the submit's tint has a faint border of the accent, as XenForo's primary button: 10 % of it", () => {
  const classes = classesOf(submitOf(draw({}))?.[0] ?? "");
  expect(classes).toContain("border");
  expect(classes).toContain("border-primary/10");
});
