import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import { WatchButton, watchOf, watchText } from "./watch-button";
import { WatchForm } from "./watch-popup";

const draw = (node: React.ReactNode) => renderToStaticMarkup(withIntl(node));
const save = async () => ({});

test("a watch is kept as text and read back as it was", () => {
  for (const watch of [
    null,
    { mode: "threads", email: false },
    { mode: "posts", email: true },
  ] as const)
    expect(watchOf(watchText(watch))).toEqual(watch);
});

test("the button names what it does until the member watches, then says Following", () => {
  const off = draw(
    <WatchButton
      item="forum:4"
      watching={null}
      label="Follow forum"
      modes
      save={save}
    />,
  );
  expect(off).toContain("Follow forum");
  expect(off).toContain('aria-haspopup="dialog"');
  const on = draw(
    <WatchButton
      item="forum:5"
      watching={{ mode: "posts", email: true }}
      label="Follow forum"
      modes
      save={save}
    />,
  );
  expect(on).toContain("Following");
  expect(on).not.toContain("Follow forum");
});

test("a forum's popover offers new threads or new posts and email, with the member's choice ticked", () => {
  const html = draw(
    <WatchForm
      current={{ mode: "posts", email: true }}
      modes
      pending={false}
      error={undefined}
      send={() => {}}
    />,
  );
  expect(html).toContain("Send notifications for");
  expect(html).toMatch(/checked="" value="posts"/);
  expect(html).not.toMatch(/checked="" value="threads"/);
  expect(html).toMatch(/name="email" checked=""/);
  expect(html).toContain(">Save<");
  expect(html).toContain(">Unfollow<");
});

test("a thread's popover holds the email box alone, and Follow for a member who does not watch it", () => {
  const html = draw(
    <WatchForm
      current={null}
      modes={false}
      pending={false}
      error="Not for you."
      send={() => {}}
    />,
  );
  expect(html).not.toContain('type="radio"');
  expect(html).not.toMatch(/name="email" checked=""/);
  expect(html).toContain(">Follow<");
  expect(html).not.toContain("Unfollow");
  expect(html).toContain("Not for you.");
});
