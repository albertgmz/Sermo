import { expect, test } from "bun:test";
import {
  type InlineContext,
  inlineAttachmentIds,
  placeAttachments,
  type TaggedAttachment,
} from "./attachment-tags";

const file = (
  fileId: number,
  over: Partial<TaggedAttachment> = {},
): TaggedAttachment => ({
  fileId,
  url: `/api/v1/files/${fileId}/plan.png`,
  thumbnailUrl: `/api/v1/files/${fileId}/thumb.png`,
  contentType: "image/png",
  byteSize: 2048,
  width: 1000,
  height: 500,
  ...over,
});

const slot = (id: number, size: "thumb" | "full" = "thumb") =>
  `<span class="bb-attach" data-attach-id="${id}" data-attach-size="${size}">${id}</span>`;

const context: InlineContext = {
  locale: "en",
  liteImages: false,
  liteLabel: "LITE MODE",
  liteAria: "Picture hidden",
};

test("a thumbnail is the thumbnail picture linked to the full file", () => {
  const html = placeAttachments(`<p>a ${slot(1)} b</p>`, [file(1)], context);
  expect(html).toContain('<a href="/api/v1/files/1/plan.png"');
  expect(html).toContain('src="/api/v1/files/1/thumb.png"');
  expect(html).toContain('width="320" height="160"');
  expect(html).not.toContain("bb-attach");
});

test("a full image is the file itself, scaled by the column", () => {
  const html = placeAttachments(slot(1, "full"), [file(1)], context);
  expect(html).toContain('src="/api/v1/files/1/plan.png"');
  expect(html).toContain('width="1000" height="500"');
  expect(html).toContain("max-w-full");
  expect(html).not.toContain("<a ");
});

test("a file that is not a picture is a row that links to it", () => {
  const pdf = file(2, {
    contentType: "application/pdf",
    url: "/api/v1/files/2/plan%20b.pdf",
  });
  const html = placeAttachments(slot(2), [pdf], context);
  expect(html).toContain('<a href="/api/v1/files/2/plan%20b.pdf"');
  expect(html).toContain("plan b.pdf");
  expect(html).not.toContain("<img");
});

test("an id that is not among the item's attachments stays as its text", () => {
  const html = `<p>${slot(9)}</p>`;
  expect(placeAttachments(html, [file(1)], context)).toBe(html);
});

test("with post pictures blocked no address of the picture reaches the page", () => {
  const html = placeAttachments(`${slot(1)} ${slot(1, "full")}`, [file(1)], {
    ...context,
    liteImages: true,
  });
  expect(html).not.toContain("/api/v1/files/1");
  expect(html).not.toContain("<img");
  expect(html.match(/LITE MODE/g)).toHaveLength(2);
});

test("with post pictures blocked a file that is not a picture is still a link", () => {
  const pdf = file(2, { contentType: "application/pdf" });
  const html = placeAttachments(slot(2), [pdf], {
    ...context,
    liteImages: true,
  });
  expect(html).toContain('href="/api/v1/files/2/plan.png"');
});

test("markup that only looks like a placeholder is left alone", () => {
  for (const html of [
    '<span class="bb-attach" data-attach-id="1" data-attach-size="thumb" onclick="x">1</span>',
    '<span class="bb-attach" data-attach-id="1" data-attach-size="huge">1</span>',
    '<span class="bb-attach" data-attach-id="1" data-attach-size="thumb">2</span>',
    '<span class="other" data-attach-id="1" data-attach-size="thumb">1</span>',
  ]) {
    expect(placeAttachments(html, [file(1)], context)).toBe(html);
    expect(inlineAttachmentIds(html, [file(1)])).toEqual([]);
  }
});

test("a name or address with markup in it is escaped", () => {
  const odd = file(1, { url: '/files/1/a"><script>.png' });
  const html = placeAttachments(slot(1, "full"), [odd], context);
  expect(html).not.toContain("<script>");
  expect(html).toContain("&quot;&gt;&lt;script&gt;");
});

test("the ids placed inline are those of the item's own attachments, each once", () => {
  const html = `${slot(1)} ${slot(1, "full")} ${slot(2)} ${slot(7)}`;
  expect(inlineAttachmentIds(html, [file(1), file(2), file(3)])).toEqual([
    1, 2,
  ]);
});
