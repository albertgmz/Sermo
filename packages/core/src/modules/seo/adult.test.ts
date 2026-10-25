import { describe, expect, test } from "bun:test";
import { insertNode, insertUser, userActor } from "@sermo/core/testing";
import { type Actor, actorUserId, GUEST } from "../../actor";
import { invalidate } from "../../context";
import { AdultContentError, type AdultRefusal, NotFoundError } from "../../errors";
import { world } from "../feed/fixtures.test";
import { updateSiteSettings } from "../settings";

/**
 * The SEO reads (what the web app settles a page load with) under the +18 mode: a plain forum with
 * a thread its author marked +18, a forum marked +18 holding a thread, a profile marked +18, and one
 * viewer of each kind.
 */
async function adultSeoWorld() {
  const w = world();
  const member = (name: string, birth?: [number, string], accepted = false) => {
    const user = insertUser(w.ctx, { username: name });
    w.ctx.sqlite
      .prepare(
        "UPDATE users SET birth_year = ?2, birthday_md = ?3, adult_accepted_at = ?4 WHERE id = ?1",
      )
      .run(user.id, birth?.[0] ?? null, birth?.[1] ?? null, accepted ? 1 : null);
    return { user, actor: userActor(user) };
  };
  const author = member("author", [1980, "03-04"], true);
  const adult = member("adult", [1990, "05-01"], true);
  const lounge = insertNode(w.ctx, { parentId: w.category.id, title: "Lounge" });
  invalidate(w.ctx, "node_tree");
  const inLounge = await w.thread(author.actor, lounge.id, "Lounge talk", "Lounge body");
  const marked = await w.thread(author.actor, w.open.id, "Marked talk", "Marked body");
  await w.call("threads.update", author.actor, { threadId: marked.thread.id, isAdult: true });
  await w.call("nodes.update", w.admin, { nodeId: lounge.id, settings: { isAdult: true } });
  await w.call("profiles.update", author.actor, { about: "Author's own words", isAdult: true });
  const mode = (adultMode: boolean) => updateSiteSettings(w.ctx, w.admin, { adultMode });
  mode(true);
  const blocked: [string, Actor, AdultRefusal][] = [
    ["guest", GUEST, "guest"],
    ["minor", member("minor", [2012, "05-01"], true).actor, "minor"],
    ["undated", member("undated").actor, "birthDate"],
    ["unaccepted", member("unaccepted", [1990, "05-01"]).actor, "acceptance"],
  ];
  const reads = {
    markedThread: ["seo.thread", { threadId: marked.thread.id }],
    threadInLounge: ["seo.thread", { threadId: inLounge.thread.id }],
    lounge: ["seo.node", { nodeId: lounge.id }],
    profile: ["seo.profile", { userId: author.user.id }],
  } as const;
  return { ...w, author, adult, lounge, inLounge, marked, mode, blocked, reads };
}

// What a read rejects with: the +18 refusal's reason, "missing" for not found, or "open".
async function outcome(
  w: Awaited<ReturnType<typeof adultSeoWorld>>,
  [name, input]: readonly [string, object],
  actor: Actor,
): Promise<AdultRefusal | "missing" | "open"> {
  try {
    await w.call(name, actor, input);
    return "open";
  } catch (error) {
    if (error instanceof NotFoundError) return "missing";
    if (!(error instanceof AdultContentError)) throw error;
    // The refusal names its reason and nothing of the content.
    expect(error.issues).toEqual([{ path: ["adult"], message: error.reason }]);
    expect(JSON.stringify({ message: error.message, issues: error.issues })).not.toMatch(
      /Lounge|Marked|author|Author/,
    );
    return error.reason;
  }
}

describe("+18 mode: the SEO reads", () => {
  test("a marked thread, a thread in a +18 forum, the forum and a +18 profile give the +18 refusal with its reason", async () => {
    const w = await adultSeoWorld();
    for (const [who, actor, reason] of w.blocked)
      for (const [what, read] of Object.entries(w.reads))
        expect({ who, what, got: await outcome(w, read, actor) }).toEqual({
          who,
          what,
          got: reason,
        });
  });

  test("an adult who confirmed the warning gets the pages, title and all", async () => {
    const w = await adultSeoWorld();
    const thread = await w.call("seo.thread", w.adult.actor, { threadId: w.marked.thread.id });
    expect(thread.title).toContain("Marked talk");
    const inLounge = await w.call("seo.thread", w.adult.actor, { threadId: w.inLounge.thread.id });
    expect(inLounge.title).toContain("Lounge talk");
    expect((await w.call("seo.node", w.adult.actor, { nodeId: w.lounge.id })).title).toContain(
      "Lounge",
    );
    expect(
      (await w.call("seo.profile", w.adult.actor, { userId: w.author.user.id })).title,
    ).toContain("author");
  });

  test("with the mode off the marks change nothing: everyone gets the pages", async () => {
    const w = await adultSeoWorld();
    w.mode(false);
    for (const [who, actor] of w.blocked)
      for (const [what, read] of Object.entries(w.reads))
        expect({ who, what, got: await outcome(w, read, actor) }).toEqual({
          who,
          what,
          got: "open",
        });
  });

  test("deleted content in a +18 forum, and a profile closed by its privacy, stay not found", async () => {
    const w = await adultSeoWorld();
    // The administrator who deletes may see +18 content.
    w.ctx.sqlite
      .prepare(
        "UPDATE users SET birth_year = 1970, birthday_md = '01-01', adult_accepted_at = 1 WHERE id = ?1",
      )
      .run(actorUserId(w.admin));
    await w.call("threads.delete", w.admin, { threadId: w.inLounge.thread.id, reason: "" });
    await w.call("threads.delete", w.admin, { threadId: w.marked.thread.id, reason: "" });
    await w.call("preferences.update", w.author.actor, { profileViewPrivacy: "followed" });
    for (const [who, actor] of w.blocked) {
      for (const read of [w.reads.threadInLounge, w.reads.markedThread])
        expect({ who, got: await outcome(w, read, actor) }).toEqual({ who, got: "missing" });
      expect({ who, got: await outcome(w, w.reads.profile, actor) }).toEqual({
        who,
        got: "missing",
      });
    }
    // A thread that never existed is not found either.
    expect(await outcome(w, ["seo.thread", { threadId: 9999 }], GUEST)).toBe("missing");
  });
});
