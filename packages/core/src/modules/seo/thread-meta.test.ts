import { expect, test } from "bun:test";
import { insertNode } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import { ForbiddenError, UnauthenticatedError, ValidationError } from "../../errors";
import { type World, world } from "../feed/fixtures.test";
import { customMember, setEntry } from "../permissions/group-fixture";

const seoOf = (w: World, id: number) => w.call("seo.thread", GUEST, { threadId: id });
const update = (w: World, actor: World["admin"], id: number, input: object) =>
  w.call("threads.update", actor, { threadId: id, ...input });

async function threadWith(w: World, body: string, title = "Una guía de plantas") {
  return (await w.thread(w.alice, w.open.id, title, body)).thread.id;
}

test("a moderator sets a title and a description that replace the template output", async () => {
  const w = world();
  const id = await threadWith(w, "Texto de la guía");
  expect((await seoOf(w, id)).title).toBe("Una guía de plantas | Sermo");
  await update(w, w.mod, id, {
    seoTitle: "Guía de plantas de interior",
    seoDescription: "Cómo cuidar las plantas de interior.",
  });
  const seo = await seoOf(w, id);
  expect(seo.title).toBe("Guía de plantas de interior");
  expect(seo.description).toBe("Cómo cuidar las plantas de interior.");
  const read = await w.call("threads.get", GUEST, { threadId: id });
  expect(read.seo.title).toBe("Guía de plantas de interior");
  expect(read.thread.title).toBe("Una guía de plantas");
});

test("the structured data keeps the thread title as its headline", async () => {
  const w = world();
  const id = await threadWith(w, "Texto");
  await w.reply(w.bob, id, "Respuesta");
  await update(w, w.mod, id, { seoTitle: "Otro título" });
  const seo = await seoOf(w, id);
  const posting = seo.jsonLd.find(
    (item: { "@type": string }) => item["@type"] === "DiscussionForumPosting",
  );
  expect(posting.headline).toBe("Una guía de plantas");
});

test("one field set leaves the other on the template", async () => {
  const w = world();
  const id = await threadWith(w, "Texto de la guía");
  await update(w, w.mod, id, { seoDescription: "Solo la descripción." });
  const seo = await seoOf(w, id);
  expect(seo.title).toBe("Una guía de plantas | Sermo");
  expect(seo.description).toBe("Solo la descripción.");
});

test("null or an empty text clears a field and the template returns", async () => {
  const w = world();
  const id = await threadWith(w, "Texto de la guía");
  await update(w, w.mod, id, { seoTitle: "Uno", seoDescription: "Dos" });
  await update(w, w.mod, id, { seoTitle: null, seoDescription: "   " });
  const seo = await seoOf(w, id);
  expect(seo.title).toBe("Una guía de plantas | Sermo");
  expect(seo.description).toBe("Texto de la guía");
  const edit = await w.call("threads.get", w.mod, { threadId: id });
  expect(edit.seoOverride).toEqual({ title: null, description: null });
});

test("a change that leaves a field out keeps the stored value", async () => {
  const w = world();
  const id = await threadWith(w, "Texto");
  await update(w, w.mod, id, { seoTitle: "Uno", seoDescription: "Dos" });
  await update(w, w.mod, id, { title: "Un título nuevo" });
  const seo = await seoOf(w, id);
  expect(seo.title).toBe("Uno");
  expect(seo.description).toBe("Dos");
});

test("the limits are 70 characters for the title and 160 for the description", async () => {
  const w = world();
  const id = await threadWith(w, "Texto");
  await update(w, w.mod, id, { seoTitle: "t".repeat(70), seoDescription: "d".repeat(160) });
  const seo = await seoOf(w, id);
  expect(seo.title).toHaveLength(70);
  expect(seo.description).toHaveLength(160);
  await expect(update(w, w.mod, id, { seoTitle: "t".repeat(71) })).rejects.toBeInstanceOf(
    ValidationError,
  );
  await expect(update(w, w.mod, id, { seoDescription: "d".repeat(161) })).rejects.toBeInstanceOf(
    ValidationError,
  );
});

test("the author of a thread cannot set the fields, and a guest is not signed in", async () => {
  const w = world();
  const id = await threadWith(w, "Texto");
  await expect(update(w, w.alice, id, { seoTitle: "Mío" })).rejects.toBeInstanceOf(ForbiddenError);
  await expect(update(w, w.bob, id, { seoDescription: "Mío" })).rejects.toBeInstanceOf(
    ForbiddenError,
  );
  await expect(update(w, GUEST, id, { seoTitle: "Mío" })).rejects.toBeInstanceOf(
    UnauthenticatedError,
  );
  expect((await seoOf(w, id)).title).toBe("Una guía de plantas | Sermo");
});

test("an author's own edit of the title does not clear what a moderator set", async () => {
  const w = world();
  const id = await threadWith(w, "Texto");
  await update(w, w.mod, id, { seoTitle: "Fijo" });
  await update(w, w.alice, id, { title: "Nuevo título" });
  expect((await seoOf(w, id)).title).toBe("Fijo");
});

test("only a moderator is shown the stored fields", async () => {
  const w = world();
  const id = await threadWith(w, "Texto");
  await update(w, w.mod, id, { seoTitle: "Fijo", seoDescription: "Descripción fija" });
  expect((await w.call("threads.get", w.mod, { threadId: id })).seoOverride).toEqual({
    title: "Fijo",
    description: "Descripción fija",
  });
  expect((await w.call("threads.get", w.alice, { threadId: id })).seoOverride).toBeNull();
  expect((await w.call("threads.get", GUEST, { threadId: id })).seoOverride).toBeNull();
});

test("the moderator log records the change", async () => {
  const w = world();
  const id = await threadWith(w, "Texto");
  await update(w, w.mod, id, { seoTitle: "Fijo", notify: false });
  const row = w.ctx.sqlite
    .query<{ details: string }, [number]>(
      "SELECT details FROM moderator_log WHERE target_type = 'thread' AND target_id = ?1 ORDER BY id DESC LIMIT 1",
    )
    .get(id);
  expect(JSON.parse(row!.details)).toMatchObject({ seoTitle: "Fijo" });
});

test("a viewer who cannot read the posts gets the title but not the description", async () => {
  const w = world();
  const id = await threadWith(w, "Texto");
  await update(w, w.mod, id, { seoTitle: "Fijo", seoDescription: "Resumen del texto cerrado" });
  w.ctx.sqlite
    .prepare(
      "INSERT INTO permission_entries (permission_id,node_id,group_id,user_id,value) VALUES ((SELECT id FROM permission_definitions WHERE key='forum.viewContent'),?1,1,0,-1)",
    )
    .run(w.open.id);
  invalidate(w.ctx, "permissions");
  const seo = await seoOf(w, id);
  expect(seo.title).toBe("Fijo");
  expect(seo.description).toBe("");
});

test("the description skips a heading that opens the first post", async () => {
  const w = world();
  const id = await threadWith(
    w,
    "[HEADING=2]Resumen actualizado[/HEADING]\nLa receta lleva tres huevos y harina.\n\n[HEADING=3]Pasos[/HEADING]\nMezclar.",
  );
  const seo = await seoOf(w, id);
  expect(seo.description).toBe("La receta lleva tres huevos y harina. Pasos Mezclar.");
});

test("the description skips several headings at the start", async () => {
  const w = world();
  const id = await threadWith(
    w,
    "  [HEADING=1]Guía[/HEADING]\n[HEADING=2]Resumen actualizado[/HEADING]\n\nTexto útil.",
  );
  expect((await seoOf(w, id)).description).toBe("Texto útil.");
});

test("the description keeps a heading when it is all the post holds, and one in the middle", async () => {
  const w = world();
  const alone = await threadWith(w, "[HEADING=2]Solo un título[/HEADING]", "Solo");
  expect((await seoOf(w, alone)).description).toBe("Solo un título");
  const middle = await threadWith(
    w,
    "Introducción.\n[HEADING=2]Parte uno[/HEADING]\nTexto.",
    "Medio",
  );
  expect((await seoOf(w, middle)).description).toBe("Introducción. Parte uno Texto.");
});

test("a bold first line and an unmarked first line stay in the description", async () => {
  const w = world();
  const bold = await threadWith(w, "[B]Resumen actualizado[/B]\nTexto.", "Negrita");
  expect((await seoOf(w, bold)).description).toBe("Resumen actualizado Texto.");
  const invalid = await threadWith(w, "[HEADING]Sin nivel[/HEADING]\nTexto.", "Sin nivel");
  expect((await seoOf(w, invalid)).description).toBe("[HEADING]Sin nivel[/HEADING] Texto.");
});

test("a heading skipped on page 1 is skipped on a later page too", async () => {
  const w = world();
  const id = await threadWith(w, "[HEADING=2]Resumen actualizado[/HEADING]\nTexto principal.");
  for (let n = 0; n < 3; n += 1) await w.reply(w.bob, id, `Respuesta ${n}`);
  const seo = await w.call("seo.thread", GUEST, { threadId: id, page: 2, pageSize: 2 });
  expect(seo.description).toBe("Texto principal.");
});

test("forum.editAny in another forum does not let a member set the fields here", async () => {
  const w = world();
  const elsewhere = insertNode(w.ctx, { parentId: w.category.id, title: "Elsewhere" });
  invalidate(w.ctx, "node_tree");
  const member = customMember(w.ctx, [
    "site.view",
    "node.view",
    "forum.viewOthers",
    "forum.viewContent",
  ]);
  setEntry(w.ctx, member.groupId, "forum.editAny", 1, elsewhere.id);
  const here = await threadWith(w, "Texto");
  const there = (await w.thread(w.alice, elsewhere.id, "Otro foro", "Texto")).thread.id;
  await expect(update(w, member.actor, here, { seoTitle: "Mío" })).rejects.toBeInstanceOf(
    ForbiddenError,
  );
  expect((await w.call("threads.get", member.actor, { threadId: here })).seoOverride).toBeNull();
  await update(w, member.actor, there, { seoTitle: "Mío" });
  expect((await seoOf(w, there)).title).toBe("Mío");
});
