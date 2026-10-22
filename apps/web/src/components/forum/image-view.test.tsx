import { expect, test } from "bun:test";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { renderToStaticMarkup } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { withIntl } from "@/lib/test-intl";
import { BB_NODES } from "./bb-lexical";
import { settleUpload, showPreview, startUpload } from "./image-node";
import { ImageView } from "./image-view";

const words = messages.editor.editor.image;

function markupOf(props: Partial<Parameters<typeof ImageView>[0]>) {
  return renderToStaticMarkup(
    withIntl(
      <LexicalComposer
        initialConfig={{
          namespace: "test",
          nodes: BB_NODES,
          onError: (error) => {
            throw error;
          },
        }}
      >
        <ImageView
          nodeKey="1"
          id={null}
          upload={null}
          full
          width={null}
          alt=""
          {...props}
        />
      </LexicalComposer>,
    ),
  );
}

test("a stored picture is the file, at the width and with the alt text it was given", () => {
  const html = markupOf({ id: 5, width: "300px", alt: "Mapa de Cuba" });
  expect(html).toContain('src="/api/v1/files/5"');
  expect(html).toContain('alt="Mapa de Cuba"');
  expect(html).toContain("width:300px");
  // A thumbnail is drawn small until it is given a size.
  expect(markupOf({ id: 5, full: false })).toContain("max-w-40");
  expect(markupOf({ id: 5 })).toContain(`alt="${words.picture}"`);
});

test("a picture on its way up is the member's own copy, dimmed, and says it is uploading", () => {
  const upload = startUpload();
  showPreview(upload, "data:image/png;base64,AAAA");
  const html = markupOf({ upload });
  expect(html).toContain('src="data:image/png;base64,AAAA"');
  expect(html).toContain("opacity-60");
  expect(html).toContain('role="status"');
  expect(html).toContain(words.uploading);
  // Before the copy is read, a box holds its place.
  expect(markupOf({ upload: startUpload() })).toContain("animate-pulse");
});

test("a refused upload says so and can be taken out", () => {
  const upload = startUpload();
  settleUpload(upload);
  const html = markupOf({ upload });
  expect(html).toContain(words.failed);
  expect(html).toContain(`aria-label="${words.remove}"`);
  expect(html).not.toContain("<img");
});

// The data saver's cookie as the page has it.
function withLiteCookie(cookie: string, draw: () => string) {
  const had = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    value: { cookie },
    configurable: true,
  });
  try {
    return draw();
  } finally {
    if (had) Object.defineProperty(globalThis, "document", had);
    else Reflect.deleteProperty(globalThis, "document");
  }
}

test("with post pictures blocked by the data saver a stored picture is not fetched", () => {
  const html = withLiteCookie("a=1; forum_lite=postImages", () =>
    markupOf({ id: 5 }),
  );
  expect(html).not.toContain("/api/v1/files/");
  expect(html).toContain(words.hidden);
  // Other blocked categories leave it alone.
  expect(
    withLiteCookie("forum_lite=avatars", () => markupOf({ id: 5 })),
  ).toContain('src="/api/v1/files/5"');
});

test("a picture still uploading shows the member's own copy under the data saver too", () => {
  const upload = startUpload();
  showPreview(upload, "data:image/png;base64,BBBB");
  const html = withLiteCookie("forum_lite=all", () => markupOf({ upload }));
  expect(html).toContain('src="data:image/png;base64,BBBB"');
});
