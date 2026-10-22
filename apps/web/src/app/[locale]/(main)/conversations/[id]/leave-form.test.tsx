import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/app/[locale]/(main)/conversations/actions", () => ({
  leaveAction: async () => ({}),
}));
const { LeaveForm } = await import("./leave-form");
const { FutureMessagesChoice } = await import("./leave-step");

const texts = {
  warning: "Leaving removes it from your list.",
  legend: "Control of future messages",
  accept: "Accept future messages",
  ignore: "Ignore future messages",
  confirm: "Leave",
  cancel: "Cancel",
};

test("the header button only opens the step: no form, no radios until it is pressed", () => {
  const html = renderToStaticMarkup(
    <LeaveForm
      conversationId={4}
      label="Leave"
      ariaLabel="Leave direct message"
      texts={texts}
    >
      <svg />
    </LeaveForm>,
  );
  expect(html).toContain('aria-label="Leave direct message"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain("<form");
  expect(html).not.toContain('type="radio"');
});

test("accepting future messages is the default choice and ignoring them the other", () => {
  const html = renderToStaticMarkup(
    <FutureMessagesChoice
      legend={texts.legend}
      accept={texts.accept}
      ignore={texts.ignore}
    />,
  );
  expect(html).toContain("<legend");
  expect(html).toMatch(
    /<input[^>]*name="futureMessages" checked="" value="accept"/,
  );
  expect(html).toMatch(/<input[^>]*name="futureMessages" value="ignore"/);
  expect(html.match(/checked/g)).toHaveLength(1);
});
