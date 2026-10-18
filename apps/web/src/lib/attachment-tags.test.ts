import { expect, test } from "bun:test";
import {
  fileName,
  type InlineContext,
  inlineAttachmentIds,
  placeAttachments,
  type TaggedAttachment,
  widthCandidates,
} from "./attachment-tags";

const file = (
  fileId: number,
  over: Partial<TaggedAttachment> = {},
): TaggedAttachment => ({
  fileId,
  url: `/api/v1/files/${fileId}/plan.png`,
  thumbnailUrl: `/api/v1/files/${fileId}/thumb.png`,
  widths: [],
  contentType: "image/png",
  byteSize: 2048,
  width: 1000,
  height: 500,
  filename: null,
  ...over,
});

const slot = (id: number, size: "thumb" | "full" = "thumb") =>
  `<span class="bb-attach" data-attach-id="${id}" data-attach-size="${size}">${id}</span>`;

const context: InlineContext = {
  locale: "en",
  liteImages: false,
  liteLabel: "DATA SAVER",
  liteAria: "Picture hidden",
  missingLabel: "Attachment",
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

// A picture 1000 wide with its thumbnail and the copy 640 wide.
const copies = [
  { url: "/api/v1/files/11", width: 320 },
  { url: "/api/v1/files/12", width: 640 },
];

test("the candidates of a picture are its copies, narrowest first, then the picture", () => {
  expect(widthCandidates(file(1, { widths: copies }))).toBe(
    "/api/v1/files/11 320w, /api/v1/files/12 640w, /api/v1/files/1/plan.png 1000w",
  );
  // Without copies, or without a known width, `src` alone draws it.
  expect(widthCandidates(file(1))).toBeNull();
  expect(widthCandidates(file(1, { widths: copies, width: null }))).toBeNull();
});

test("a full image with copies lets the browser take the one its box needs", () => {
  const html = placeAttachments(
    slot(1, "full"),
    [file(1, { widths: copies })],
    context,
  );
  expect(html).toContain('src="/api/v1/files/1/plan.png"');
  expect(html).toContain(
    'srcset="/api/v1/files/11 320w, /api/v1/files/12 640w, /api/v1/files/1/plan.png 1000w"',
  );
  // Its box is the picture's width or the column's, whichever is less.
  expect(html).toContain('sizes="auto, (max-width: 1000px) 100vw, 1000px"');
  expect(html).toContain('width="1000" height="500" loading="lazy"');
  // A full image without copies, and a thumbnail, are one file each.
  expect(placeAttachments(slot(1, "full"), [file(1)], context)).not.toContain(
    "srcset",
  );
  expect(
    placeAttachments(slot(1), [file(1, { widths: copies })], context),
  ).not.toContain("srcset");
  // With post pictures blocked no copy is named either.
  const lite = placeAttachments(
    slot(1, "full"),
    [file(1, { widths: copies })],
    {
      ...context,
      liteImages: true,
    },
  );
  expect(lite).not.toContain("srcset");
  expect(lite).not.toContain("/api/v1/files/");
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

test("an id that is not among the item's attachments shows a label, not the number", () => {
  const html = placeAttachments(`<p>${slot(9)}</p>`, [file(1)], context);
  expect(html).toContain(">Attachment</span>");
  expect(html).not.toContain(">9<");
  expect(html).not.toContain("bb-attach");
});

test("an item with no attachments at all labels its tags the same way", () => {
  expect(placeAttachments(slot(3), [], context)).toContain(">Attachment<");
});

test("inside a link no second link is made", () => {
  const pdf = file(2, { contentType: "application/pdf" });
  const linked = (inner: string) =>
    `<a href="https://example.com/">${inner}</a>`;
  const thumb = placeAttachments(linked(slot(1)), [file(1)], context);
  expect(thumb.match(/<a /g)).toHaveLength(1);
  expect(thumb).toContain("<img");
  const full = placeAttachments(linked(slot(1, "full")), [file(1)], context);
  expect(full.match(/<a /g)).toHaveLength(1);
  expect(full).toContain("<img");
  const row = placeAttachments(linked(slot(2)), [pdf], context);
  expect(row.match(/<a /g)).toHaveLength(1);
  expect(row).toContain("plan.png</a>");
  const lite = placeAttachments(linked(slot(1)), [file(1)], {
    ...context,
    liteImages: true,
  });
  expect(lite.match(/<a /g)).toHaveLength(1);
  expect(lite).not.toContain("/api/v1/files/1");
});

test("after the link is closed the attachment is a link again", () => {
  const html = placeAttachments(
    `<a href="/x">t</a> ${slot(1)} <abbr>${slot(1)}</abbr>`,
    [file(1)],
    context,
  );
  expect(html.match(/<a /g)).toHaveLength(3);
});

test("with post pictures blocked no address of the picture reaches the page", () => {
  const html = placeAttachments(`${slot(1)} ${slot(1, "full")}`, [file(1)], {
    ...context,
    liteImages: true,
  });
  expect(html).not.toContain("/api/v1/files/1");
  expect(html).not.toContain("<img");
  expect(html.match(/DATA SAVER/g)).toHaveLength(2);
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

test("a file is called by the name it was uploaded with, or by its address when it has none", () => {
  expect(fileName(file(1, { filename: "informe económico.pdf" }))).toBe(
    "informe económico.pdf",
  );
  expect(fileName(file(2))).toBe("plan.png");
  expect(fileName(file(3, { url: "/api/v1/files/3" }))).toBe("3");
});

test("a file placed inline shows its uploaded name", () => {
  const pdf = file(1, {
    contentType: "application/pdf",
    filename: "informe económico.pdf",
  });
  const html = placeAttachments(slot(1), [pdf], context);
  expect(html).toContain("informe económico.pdf");
  expect(html).not.toContain(">plan.png<");
});

test("video and audio placed inline play in the browser's player, with a row to download", () => {
  const video = file(3, {
    contentType: "video/webm",
    url: "/api/v1/files/3",
    filename: "clip.webm",
    width: null,
    height: null,
  });
  const audio = file(4, {
    contentType: "audio/ogg",
    url: "/api/v1/files/4",
    filename: "song.ogg",
    width: null,
    height: null,
  });
  const html = placeAttachments(
    `<p>${slot(3)} and ${slot(4, "full")}</p>`,
    [video, audio],
    context,
  );
  expect(html).toContain(
    '<video controls preload="metadata" playsinline src="/api/v1/files/3" aria-label="clip.webm"',
  );
  expect(html).toContain(
    '<audio controls preload="metadata" src="/api/v1/files/4" aria-label="song.ogg"',
  );
  expect(html).not.toContain("autoplay");
  expect(html).toContain('<a href="/api/v1/files/3" download="clip.webm"');
  expect(html).toContain('<a href="/api/v1/files/4" download="song.ogg"');
  // Inside a paragraph nothing but inline elements is placed.
  expect(html).not.toMatch(/<(?:div|figure)\b/);
  // Inside a link it is only its name.
  expect(
    placeAttachments(`<a href="/x">${slot(3)}</a>`, [video], context),
  ).toBe('<a href="/x">clip.webm</a>');
});

test("with post pictures blocked video and audio placed inline are plain rows", () => {
  const video = file(3, {
    contentType: "video/mp4",
    url: "/api/v1/files/3",
    filename: "clip.mp4",
  });
  const html = placeAttachments(`<p>${slot(3)}</p>`, [video], {
    ...context,
    liteImages: true,
  });
  expect(html).not.toMatch(/<(?:video|audio|source)\b/);
  expect(html).not.toContain("preload");
  expect(html).toContain('<a href="/api/v1/files/3" download="clip.mp4"');
  expect(html).toContain("clip.mp4");
});
