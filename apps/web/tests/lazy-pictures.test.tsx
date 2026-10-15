import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AvatarImage } from "../src/components/ui/avatar";

test("an avatar picture loads lazily and decodes off the main thread", () => {
  const html = renderToStaticMarkup(<AvatarImage src="/a.webp" alt="" />);
  expect(html).toContain('loading="lazy"');
  expect(html).toContain('decoding="async"');
});

test("a caller can still ask for an avatar picture at once", () => {
  const html = renderToStaticMarkup(
    <AvatarImage src="/a.webp" alt="" loading="eager" />,
  );
  expect(html).toContain('loading="eager"');
  expect(html).not.toContain('loading="lazy"');
});
