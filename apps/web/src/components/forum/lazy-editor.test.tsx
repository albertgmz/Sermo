import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { withIntl } from "@/lib/test-intl";
import { Editor } from "./editor";
import { Toolbar } from "./editor-toolbar";
import { handOver, keptPresses, LazyEditor } from "./lazy-editor";

test("the one-line box of a line composer is a plain field of the form, with no formatting bar, until it is entered", () => {
  const html = renderToStaticMarkup(
    <LazyEditor name="body" placeholder="Write a message…" line />,
  );
  expect(html).toContain("<textarea");
  expect(html).toContain('name="body"');
  expect(html).toContain('placeholder="Write a message…"');
  expect(html).not.toContain("toolbar");
  expect(html).not.toContain("contenteditable");
});

test("before the editor's code is there the box already has the editor's formatting bar, over a plain field of the form", () => {
  const html = renderToStaticMarkup(
    withIntl(
      <LazyEditor name="body" placeholder="Write a message…" bar={Toolbar} />,
    ),
  );
  expect(html).toMatch(
    new RegExp(
      `<div[^>]*role="toolbar"[^>]*aria-label="${messages.editor.editor.aria.formatting}"`,
    ),
  );
  expect(html.indexOf('role="toolbar"')).toBeLessThan(
    html.indexOf("<textarea"),
  );
  expect(html).toContain('name="body"');
  expect(html).not.toContain("contenteditable");
});

// The markup from `start` (the opening tag of a div) to the end of that div.
function divAt(html: string, start: number) {
  let depth = 0;
  for (const tag of html.slice(start).matchAll(/<(\/?)div\b[^>]*>/g)) {
    depth += tag[1] ? -1 : 1;
    if (depth === 0)
      return html.slice(start, start + tag.index + tag[0].length);
  }
  throw new Error("the div does not close");
}

// The box and its formatting bar as drawn, with the ids React makes (which depend on where in the
// page a component is) numbered in order.
function frameOf(html: string) {
  const box = html.match(/<div class="group\/editor[^"]*"[^>]*>/)?.[0];
  const bar = divAt(html, html.indexOf('<div class="@container'));
  const ids = new Map<string, string>();
  const numbered = bar.replace(
    /(id|aria-controls)="([^"]*?)(-[a-z]+)?"/g,
    (_, name: string, id: string, suffix = "") => {
      if (!ids.has(id)) ids.set(id, `id${ids.size}`);
      return `${name}="${ids.get(id)}${suffix}"`;
    },
  );
  return { box, bar: numbered };
}

test("the bar drawn first is the editor's own bar, button for button, in the editor's own box", () => {
  for (const props of [
    { compact: false },
    { compact: true, className: "rounded-none border-0" },
  ]) {
    const shell = frameOf(
      renderToStaticMarkup(
        withIntl(
          <LazyEditor
            name="body"
            placeholder="Write"
            bar={Toolbar}
            {...props}
          />,
        ),
      ),
    );
    const editor = frameOf(
      renderToStaticMarkup(
        withIntl(<Editor name="body" placeholder="Write" toolbar {...props} />),
      ),
    );
    expect(shell.box).toBeDefined();
    expect(shell.box).toBe(editor.box);
    expect(shell.bar).toContain('role="toolbar"');
    expect(shell.bar).toBe(editor.bar);
  }
});

// A static import of the editor anywhere in these files would put its code back in the first
// load of the pages that show a composer.
test("the composers reach the editor's code only through the import made once the page is idle", () => {
  const source = (path: string) =>
    readFileSync(join(import.meta.dir, "../..", path), "utf8");
  const lazy = source("components/forum/lazy-editor.tsx");
  expect(lazy).toContain('import("@/components/forum/editor")');
  for (const path of [
    "components/forum/lazy-editor.tsx",
    "components/forum/composer.tsx",
    "components/forum/attachment-field.tsx",
    "components/forum/line-composer.tsx",
    "components/forum/composer-buttons.tsx",
    "app/[locale]/(main)/members/post-composer.tsx",
    "app/[locale]/(main)/threads/[id]/reply-composer.tsx",
  ]) {
    const imports = source(path).match(/^import (?!type )[^;]*;/gm) ?? [];
    for (const line of imports) {
      expect(line, path).not.toMatch(/forum\/editor"|lexical/);
    }
  }
});

// What a page loads with it, by static imports only.
function staticGraph(entry: string) {
  const src = resolve(import.meta.dir, "../..");
  const fileOf = (spec: string, from: string) => {
    const base = spec.startsWith("@/")
      ? join(src, spec.slice(2))
      : resolve(dirname(from), spec);
    return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(existsSync);
  };
  const seen = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const [, spec] of text.matchAll(
      /^(?:import|export) (?!type )[^;]*?from "([^"]+)";|^import "([^"]+)";/gm,
    )) {
      if (!spec) continue;
      if (spec.startsWith("@/") || spec.startsWith(".")) {
        const next = fileOf(spec, file);
        if (next) visit(next);
      } else packages.add(spec);
    }
  };
  visit(join(src, entry));
  return {
    files: [...seen].map((file) => relative(src, file)),
    lexical: [...packages].filter((name) => /^(lexical|@lexical\/)/.test(name)),
  };
}

// The bar is in the first load of the pages whose box is in view with the page, and neither it nor
// the box brings Lexical or the editor with it.
test("nothing the box or its bar loads with the page reaches Lexical or the editor", () => {
  for (const entry of [
    "components/forum/lazy-editor.tsx",
    "components/forum/editor-toolbar.tsx",
  ]) {
    const { files, lexical } = staticGraph(entry);
    expect(files, entry).not.toContain("components/forum/editor.tsx");
    expect(lexical, entry).toEqual([]);
  }
});

// The feed holds many boxes that are not in view with the page (a wall post's composer in its
// dialog, inline edits, the line composers of comments): they fetch the bar when they are drawn.
test("only the boxes in view with the page bring the bar's code with it", () => {
  const bar = "components/forum/editor-toolbar.tsx";
  for (const entry of [
    "components/forum/lazy-editor.tsx",
    "components/forum/composer.tsx",
    "components/forum/line-composer.tsx",
    "components/forum/inline-edit-form.tsx",
    "app/[locale]/(main)/members/post-composer.tsx",
    "app/[locale]/(main)/_feed/feed-page.tsx",
  ])
    expect(staticGraph(entry).files, entry).not.toContain(bar);
  const source = (path: string) =>
    readFileSync(join(import.meta.dir, "../..", path), "utf8");
  for (const path of [
    "components/forum/quick-reply-editor.tsx",
    "app/[locale]/(main)/threads/[id]/edit/[postId]/edit-post-form.tsx",
    "app/[locale]/(main)/conversations/new/new-conversation-form.tsx",
    "components/forum/thread-composer.tsx",
  ])
    expect(source(path), path).toContain("bar={Toolbar}");
  expect(source("components/forum/lazy-editor.tsx")).toContain(
    'import("@/components/forum/editor-toolbar")',
  );
});

test("a box with no bar handed over keeps the bar's band, as tall as the bar, until its code is there", () => {
  const html = renderToStaticMarkup(
    withIntl(<LazyEditor name="body" placeholder="Write" />),
  );
  expect(html).not.toContain('role="toolbar"');
  const band = html.match(
    /<div aria-hidden="true" class="([^"]*)"><div class="h-\[42px\]"><\/div><\/div><textarea/,
  );
  expect(band).not.toBeNull();
  // The bar's own band: its padding and border round a 42 px group, the same fills.
  const toolbar =
    renderToStaticMarkup(
      withIntl(<LazyEditor name="body" placeholder="Write" bar={Toolbar} />),
    )
      .match(/<div role="toolbar"[^>]*class="([^"]*)"/)?.[1]
      .split(" ") ?? [];
  for (const name of band?.[1].split(" ") ?? [])
    expect(toolbar).toContain(name);
});

test("the roomy plain field keeps the editor's padding and height, so the page does not move", () => {
  const html = renderToStaticMarkup(
    withIntl(<LazyEditor name="body" placeholder="Write" compact={false} />),
  );
  expect(html).toContain("pt-2.5 px-5 pb-5");
  expect(html).toContain("min-height:100px");
  const compact = renderToStaticMarkup(
    withIntl(<LazyEditor name="body" placeholder="Write" />),
  );
  expect(compact).toContain("px-3 py-2");
  expect(compact).toContain("min-height:40px");
});

// The edit pages and the new conversation page used to carry the whole editor in their first load.
// They show the editor's box with a plain field, and the editor comes once the page is idle.
test("the edit pages and the new conversation page load the editor only after the page", () => {
  const source = (path: string) =>
    readFileSync(join(import.meta.dir, "../..", path), "utf8");
  for (const path of [
    "app/[locale]/(main)/threads/[id]/edit/[postId]/edit-post-form.tsx",
    "app/[locale]/(main)/conversations/new/new-conversation-form.tsx",
  ]) {
    const text = source(path);
    expect(text, path).toContain("<LazyEditor");
    const imports = text.match(/^import (?!type )[^;]*;/gm) ?? [];
    for (const line of imports) {
      expect(line, path).not.toMatch(/forum\/editor"|lexical/);
    }
  }
});

test("a box that edits what was written is a field that holds its BB code", () => {
  const html = renderToStaticMarkup(
    withIntl(
      <LazyEditor
        name="body"
        placeholder="Write"
        compact={false}
        defaultValue={"[B]kept[/B]\n\n\n\nas written"}
      />,
    ),
  );
  expect(html).toContain("<textarea");
  expect(html).toContain("[B]kept[/B]");
  expect(html).toContain('name="body"');
});

test("the editor is asked for once the page is idle, except by the one-line box, which waits to be entered", () => {
  const lazy = readFileSync(join(import.meta.dir, "lazy-editor.tsx"), "utf8");
  expect(lazy).toMatch(/if \(line\) return;\s*return whenIdle\(load\);/);
  // Entering the box or pressing anything in it asks at once. The field asks from its own focus
  // handler, which is there as soon as the field is: a composer that puts the focus in the field
  // the moment it is drawn (a feed card's Reply) does so before the box's listeners are added.
  expect(lazy).toMatch(
    /onFocus=\{\(\) => \{\s*entered\.current = true;\s*load\(\);\s*\}\}/,
  );
  expect(lazy).toContain('element.addEventListener("focusin", load);');
  expect(lazy).toContain('element.addEventListener("click", load);');
});

test("a press on the bar before the editor is in asks for the editor at once and is kept for it, in order", () => {
  let asked = 0;
  const form = {} as HTMLFormElement;
  const { target, pressed } = keptPresses(
    () => {
      asked += 1;
    },
    () => form,
  );
  expect(target.ready).toBe(false);
  target.run({ format: "bold" });
  expect(asked).toBe(1);
  target.run({ insert: "[IMG]https://x.test/a.png[/IMG]" });
  expect(pressed).toEqual([
    { format: "bold" },
    { insert: "[IMG]https://x.test/a.png[/IMG]" },
  ]);
  // The picture picker of the composer is reached at once (a browser opens it only in the press).
  expect(target.form()).toBe(form);
  // Nothing is on in a box that is not the editor yet.
  let told = 0;
  target.watch(() => {
    told += 1;
  })();
  expect(told).toBe(0);
});

test("the editor takes over what was typed, the caret, and where the focus was", () => {
  const field = { value: "typed before", selectionStart: 3, selectionEnd: 6 };
  // Writing in the box: the editor takes the focus with the same selection.
  expect(
    handOver({
      field,
      entered: true,
      inField: true,
      control: null,
      pressed: 0,
    }),
  ).toEqual({
    text: "typed before",
    focused: true,
    selection: { start: 3, end: 6 },
    control: null,
  });
  // Gone elsewhere: the text, and no focus taken.
  expect(
    handOver({
      field,
      entered: true,
      inField: false,
      control: null,
      pressed: 0,
    }).focused,
  ).toBe(false);
  // On a button of the bar, from the keyboard: the editor's bar puts the focus back on it.
  expect(
    handOver({
      field,
      entered: false,
      inField: false,
      control: "more-insert",
      pressed: 0,
    }),
  ).toEqual({
    text: "typed before",
    focused: false,
    selection: undefined,
    control: "more-insert",
  });
  // A press waits for the text: the editor takes the focus, at the end of a box never entered.
  expect(
    handOver({
      field,
      entered: false,
      inField: false,
      control: "bold",
      pressed: 1,
    }),
  ).toEqual({
    text: "typed before",
    focused: true,
    selection: undefined,
    control: null,
  });
});
