import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PictureImage } from "./picture-image";
import type { GatedUrl } from "./picture-types";

test("a picture the server let through is drawn with its own proportions", () => {
  const html = renderToStaticMarkup(
    <PictureImage
      url={"/api/v1/files/7" as GatedUrl}
      width={640}
      height={480}
      alt="Picture in Tomatoes"
      blocked="off"
    />,
  );
  expect(html).toContain('src="/api/v1/files/7"');
  expect(html).toContain('width="640"');
  expect(html).toContain('height="480"');
  expect(html).toContain('alt="Picture in Tomatoes"');
});

test("with no address (LITE) nothing is emitted and the box says so", () => {
  const html = renderToStaticMarkup(
    <PictureImage
      url={null}
      width={640}
      height={480}
      alt="Picture in Tomatoes"
      blocked="Pictures are off"
    />,
  );
  expect(html).not.toContain("<img");
  expect(html).not.toContain("src=");
  expect(html).toContain('aria-label="Picture in Tomatoes"');
  expect(html).toContain("Pictures are off");
});
