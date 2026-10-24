import { afterAll, expect, mock, test } from "bun:test";
import type { ComponentType, ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

// The wall composer's code (the sheet, the editor shell, the attachments) is fetched when the closed
// line is first reached for. The line drawn until then must be the line the real composer draws.

mock.module("server-only", () => ({}));
type Captured = {
  load: () => Promise<{ default: ComponentType<Record<string, unknown>> }>;
  popup: Record<string, unknown>;
  trigger: (lazy: Record<string, unknown>) => ReactElement;
};
let captured: Captured | undefined;
const realPopup = { ...(await import("@/components/ui/lazy-popup")) };
mock.module("@/components/ui/lazy-popup", () => ({
  ...realPopup,
  LazyPopup: (props: Captured) => {
    captured = props;
    return props.trigger({});
  },
}));
afterAll(() => {
  mock.module("@/components/ui/lazy-popup", () => realPopup);
});

const { LazyPostComposer } = await import("./lazy-post-composer");
const { PostComposer } = await import("./post-composer");

const props = {
  action: async () => ({}),
  avatar: <span>EM</span>,
  name: "ember",
  placeholder: "What's on your mind?",
  className: "p-4",
};

// What the line shows and says: its classes, the buttons' names and the text of the pill.
function line(html: string) {
  const buttons = [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map(
    ([, attributes, text]) => ({
      class: /class="([^"]*)"/.exec(attributes)?.[1],
      label: /aria-label="([^"]*)"/.exec(attributes)?.[1],
      title: /title="([^"]*)"/.exec(attributes)?.[1],
      text: text.replace(/<[^>]*>/g, ""),
    }),
  );
  return { wrapper: /<div class="([^"]*)"/.exec(html)?.[1], buttons };
}

test("until the member reaches for it, the closed line is the real composer's line and holds no field", () => {
  const plain = renderToStaticMarkup(withIntl(<LazyPostComposer {...props} />));
  const real = renderToStaticMarkup(withIntl(<PostComposer {...props} />));
  expect(line(plain)).toEqual(line(real));
  expect(line(plain).buttons).toHaveLength(2);
  expect(plain).toContain("<span>EM</span>");
  expect(plain).not.toContain("<textarea");
});

test("what is loaded is the composer, mounted open, given the page's own props", async () => {
  renderToStaticMarkup(withIntl(<LazyPostComposer {...props} />));
  const call = captured as Captured;
  expect(call.popup).toMatchObject({
    name: "ember",
    placeholder: "What's on your mind?",
  });
  const Opened = (await call.load()).default;
  const html = renderToStaticMarkup(withIntl(<Opened {...call.popup} />));
  expect(html.match(/<button/g)?.length).toBeGreaterThanOrEqual(2);
});
