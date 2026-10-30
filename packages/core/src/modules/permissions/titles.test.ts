import { describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { ForbiddenError } from "../../errors";
import en from "../../i18n/locales/en.json";
import es from "../../i18n/locales/es.json";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { PERMISSION_IDS } from "../../permissions";
import { criterionDefinitions } from "../../shared/criteria";
import { readableTitle, titleFor } from "../../shared/language";
import { readSiteSettings, storeSiteSettings } from "../settings";

function world() {
  const ctx = createTestContext();
  storeSiteSettings(ctx, { ...readSiteSettings(ctx), defaultLanguage: "en" });
  const admin = insertUser(ctx, { groupId: 4 });
  return { ctx, admin: userActor(admin), adminId: admin.id };
}
const run = (w: ReturnType<typeof world>, name: string) =>
  execute(w.ctx, getOperation(name), w.admin, {}) as Promise<{
    items: { id: string; label: string; title: string; help: string; categoryTitle?: string }[];
  }>;

describe("titles a client can show", () => {
  test("every permission has a title and a category title that are not the raw keys", async () => {
    const w = world();
    const { items } = await run(w, "permissions.definitions");
    expect(items.map((item) => item.id)).toEqual([...PERMISSION_IDS]);
    for (const item of items) {
      expect(item.title.trim(), item.id).not.toBe("");
      expect(item.title, item.id).not.toBe(item.label);
      expect(item.title, item.id).not.toBe(item.id);
      expect(item.categoryTitle?.trim(), item.id).toBeTruthy();
      expect(item.categoryTitle, item.id).not.toMatch(/^permission\./);
      expect(item.label).toBe(`permission.${item.id}`);
    }
  });

  test("every permission has its own label and description phrase in English and in Spanish", () => {
    for (const [language, phrases] of [
      ["en", en],
      ["es", es],
    ] as const) {
      const held = phrases as Record<string, string>;
      for (const id of PERMISSION_IDS) {
        expect(held[`permission.${id}`]?.trim(), `${language} ${id}`).toBeTruthy();
        expect(held[`permission.${id}.description`]?.trim(), `${language} ${id}`).toBeTruthy();
      }
    }
    // Spanish text that is the English one is a phrase nobody translated.
    const untranslated = PERMISSION_IDS.filter(
      (id) =>
        (es as Record<string, string>)[`permission.${id}`] ===
        (en as Record<string, string>)[`permission.${id}`],
    );
    expect(untranslated).toEqual([]);
  });

  test("no permission text is a placeholder made from its id", () => {
    for (const [language, phrases] of [
      ["en", en],
      ["es", es],
    ] as const) {
      const held = phrases as Record<string, string>;
      for (const id of PERMISSION_IDS) {
        const label = held[`permission.${id}`]!;
        const description = held[`permission.${id}.description`]!;
        expect(label.toLowerCase(), `${language} ${id}`).not.toBe(readableTitle(id).toLowerCase());
        expect(description, `${language} ${id}`).not.toBe(`Allows ${label}.`);
        expect(description.toLowerCase(), `${language} ${id}`).not.toBe(`${label.toLowerCase()}.`);
        expect(description, `${language} ${id}`).not.toMatch(/^Allows [a-z ]+\.$/);
      }
    }
  });

  test("every criterion has a title, in both operations that list them", async () => {
    const w = world();
    for (const name of ["promotions.criteria", "awards.criteria"]) {
      const { items } = await run(w, name);
      expect(items.map((item) => item.id)).toEqual(criterionDefinitions.map((item) => item.id));
      for (const item of items) {
        expect(item.title.trim(), item.id).not.toBe("");
        expect(item.title, item.id).not.toBe(item.label);
        expect(item.label).toBe(`criterion.${item.id}`);
        expect(item.help.trim(), item.id).not.toBe("");
      }
    }
  });

  test("the titles follow the viewer's language", async () => {
    const w = world();
    const english = await run(w, "permissions.definitions");
    w.ctx.sqlite.prepare("UPDATE users SET language = 'es' WHERE id = ?1").run(w.adminId);
    const spanish = await run(w, "permissions.definitions");
    const category = (list: typeof english.items) =>
      list.find((item) => item.id === "forum.reply")!.categoryTitle;
    expect(category(english.items)).toBe("Forums");
    expect(category(spanish.items)).toBe("Foros");
    const criteriaEs = await run(w, "promotions.criteria");
    expect(criteriaEs.items.find((item) => item.id === "post_count")!.title).toBe(
      "Número de publicaciones",
    );
  });

  test("the rule builder names the built-in groups in the viewer's language", async () => {
    const w = world();
    const groups = async () =>
      (
        (await execute(w.ctx, getOperation("criteria.list"), w.admin, {})) as {
          groups: { title: string }[];
        }
      ).groups.map((group) => group.title);
    expect(await groups()).toContain("Administrator");
    w.ctx.sqlite.prepare("UPDATE users SET language = 'es' WHERE id = ?1").run(w.adminId);
    expect(await groups()).toContain("Administrador");
    w.ctx.sqlite.prepare("UPDATE groups SET title = 'Founders' WHERE builtin = 'admin'").run();
    expect(await groups()).toContain("Founders");
  });

  test("a key without a phrase gets a readable title made from the id, never an empty one", () => {
    expect(readableTitle("forum.viewLog")).toBe("Forum view log");
    expect(readableTitle("post_count")).toBe("Post count");
    expect(titleFor("en", "permission.no.such.phrase", "forum.viewLog")).toBe("Forum view log");
    expect(titleFor("es", "permission.no.such.phrase", "post_count")).toBe("Post count");
  });

  test("the reads keep their permission checks", async () => {
    const w = world();
    const member = userActor(insertUser(w.ctx, {}));
    for (const name of ["permissions.definitions", "promotions.criteria", "awards.criteria"])
      await expect(execute(w.ctx, getOperation(name), member, {})).rejects.toBeInstanceOf(
        ForbiddenError,
      );
  });
});
