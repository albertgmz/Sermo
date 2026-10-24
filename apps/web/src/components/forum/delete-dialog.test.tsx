import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

// Another suite replaces the translator with one that fills no placeholders: use the real one.
const intl = { ...(await import("next-intl")) };
const { useTranslations } = await import("use-intl");
mock.module("next-intl", () => ({
  ...intl,
  useLocale: () => "en",
  useTranslations,
}));
afterAll(() => {
  mock.module("next-intl", () => intl);
});
const { DeleteDialog } = await import("./delete-dialog");
const { deleteMode } = await import("./delete-mode");

const action = async () => ({});
const draw = (permanent?: "choice" | "only") =>
  renderToStaticMarkup(
    withIntl(<DeleteDialog open action={action} permanent={permanent} />),
  );

test("without the permission the dialog is the soft delete and a reason, with no choice", () => {
  const html = draw();
  expect(html).toContain('name="reason"');
  expect(html).not.toContain('type="radio"');
  expect(html).not.toContain("hardDelete");
  expect(html).not.toContain("Delete permanently");
});

test("with the permission it offers removing from public view, selected, or deleting permanently, and a reason", () => {
  const html = draw("choice");
  expect(html).toContain("Type of deletion");
  const radios = [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map(
    (match) => match[0],
  );
  expect(radios).toHaveLength(2);
  expect(radios[0]).toContain('value="0"');
  expect(radios[0]).toContain('checked=""');
  expect(radios[1]).toContain('value="1"');
  expect(radios[1]).not.toContain("checked");
  for (const radio of radios) expect(radio).toContain('name="hardDelete"');
  expect(html).toContain("Remove from public view");
  expect(html).toContain("Delete permanently");
  expect(html).toContain('name="reason"');
});

test("an item that is already deleted gets only the permanent delete, asked for by a hidden field", () => {
  const html = draw("only");
  expect(html).not.toContain('type="radio"');
  expect(html).toMatch(
    /<input[^>]*type="hidden"[^>]*name="hardDelete"[^>]*value="1"/,
  );
  expect(html).toContain("permanently and irreversibly");
  expect(html).toContain('name="reason"');
});

test("the viewer is offered what the backend allows: hide, and for good when they hold the permission", () => {
  const item = (state: "visible" | "deleted", flags: [boolean, boolean]) => ({
    state,
    canDelete: flags[0],
    canHardDelete: flags[1],
  });
  // A member who may only hide.
  expect(deleteMode(item("visible", [true, false]), false)).toEqual({
    show: true,
  });
  // Staff holding the permission reach a live item by hiding it first.
  expect(deleteMode(item("visible", [true, false]), true)).toEqual({
    show: true,
    permanent: "choice",
  });
  // An author who may delete their own live item for good in one step.
  expect(deleteMode(item("visible", [true, true]), false).permanent).toBe(
    "choice",
  );
  expect(deleteMode(item("visible", [false, true]), false).permanent).toBe(
    "only",
  );
  // A deleted item: only the permanent delete, and only with the backend's word.
  expect(deleteMode(item("deleted", [true, true]), true)).toEqual({
    show: true,
    permanent: "only",
  });
  expect(deleteMode(item("deleted", [true, false]), true)).toEqual({
    show: false,
  });
  expect(deleteMode(item("visible", [false, false]), true)).toEqual({
    show: false,
  });
});

test("the dialog is one component for every kind of content: each screen reaches it through the bar", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const read = (file: string) =>
    readFileSync(join(import.meta.dir, "..", "..", file), "utf8");
  expect(read("components/forum/content-actions.tsx")).toContain(
    "delete-dialog",
  );
  for (const file of [
    "app/[locale]/(main)/threads/[id]/post-actions.tsx",
    "components/forum/wall-item-actions.tsx",
    "app/[locale]/(main)/conversations/[id]/message-actions.tsx",
  ]) {
    const source = read(file);
    expect(source, file).toContain("deleteMode");
    expect(source, file).not.toContain("DeleteControl");
  }
  expect(read("app/[locale]/(main)/threads/[id]/moderation.tsx")).toContain(
    "DeleteDialog",
  );
});
