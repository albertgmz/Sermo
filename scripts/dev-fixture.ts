import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  type Actor,
  closeContext,
  createContext,
  ensureAdmin,
  execute,
  getAuth,
  getOperation,
  resolveActor,
} from "@sermo/core";
import { readConfiguration } from "../packages/api/src/server";

if (process.env.NODE_ENV === "production") {
  console.error("The development fixture does not run with NODE_ENV=production.");
  process.exit(1);
}

const config = readConfiguration();
const password = process.env.SERMO_DEV_PASSWORD || "sermo-dev-password";
mkdirSync(dirname(config.path), { recursive: true });
const ctx = createContext({
  path: config.path,
  migrate: true,
  config: { auth: config.auth },
});

const exists = ctx.sqlite
  .prepare<{ id: number }, [string]>("SELECT id FROM auth_user WHERE username = ?1")
  .get("nova");
if (exists) {
  console.log("The development fixture is already loaded; nothing was changed.");
  closeContext(ctx);
  process.exit(0);
}
// Only an empty database: next to existing accounts the fixture would stop halfway.
if (ctx.sqlite.prepare("SELECT 1 FROM auth_user LIMIT 1").get()) {
  console.error("The development fixture only loads into a database without accounts.");
  closeContext(ctx);
  process.exit(1);
}

const GROUP = { member: 2, moderator: 3 };
const REACTION = { like: 1, love: 2 };
const emailOf = (name: string) => `${name}@example.test`;

// Accounts go through Better Auth; each member then signs in and is resolved to an actor from the
// session cookie, exactly as a request would be.
const ids: Record<string, number> = {};
const cookies: Record<string, string> = {};
ids.nova = (await ensureAdmin(ctx, { username: "nova", email: emailOf("nova"), password })).userId;
for (const name of ["kestrel", "ember", "wren"]) {
  const result = await getAuth(ctx).api.signUpEmail({
    body: { name, username: name, email: emailOf(name), password },
  });
  ids[name] = Number(result.user.id);
}
for (const name of Object.keys(ids)) {
  const signedIn = await getAuth(ctx).api.signInEmail({
    body: { email: emailOf(name), password },
    returnHeaders: true,
  });
  const cookie = signedIn.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  cookies[name] = cookie;
}

// Resolved again for every call: a permission or group change makes an earlier actor stale.
const actorOf = async (name: string): Promise<Actor> =>
  (await resolveActor(ctx, new Headers({ cookie: cookies[name]! }))).actor;
const run = async <T>(name: string, as: string, input: unknown) =>
  (await execute(ctx, getOperation(name), await actorOf(as), input)) as T;
type Created = { id: number };

await run("users.setGroups", "nova", {
  userId: ids.kestrel,
  primaryGroupId: GROUP.member,
  secondaryGroupIds: [GROUP.moderator],
});

const categories = [
  { title: "Growing", forums: ["Vegetables and herbs", "Flowers and shrubs"] },
  { title: "Community", forums: ["Tools and gear", "Garden show and tell"] },
];
const forums: number[] = [];
for (const [position, category] of categories.entries()) {
  const parent = await run<Created>("nodes.create", "nova", {
    parentId: null,
    type: "category",
    title: category.title,
    position,
  });
  for (const [index, title] of category.forums.entries())
    forums.push(
      (
        await run<Created>("nodes.create", "nova", {
          parentId: parent.id,
          type: "forum",
          title,
          position: index,
        })
      ).id,
    );
}

const threads = [
  { forum: 0, by: "ember", title: "When to start tomatoes indoors", replies: ["wren", "kestrel"] },
  { forum: 0, by: "wren", title: "Welcome to the garden forum", replies: ["nova", "ember"] },
  { forum: 1, by: "kestrel", title: "Pruning roses in late winter", replies: ["ember", "wren"] },
  { forum: 1, by: "ember", title: "Perennials that survive a cold snap", replies: ["wren"] },
  { forum: 2, by: "wren", title: "Is a hori hori knife worth it?", replies: ["ember", "nova"] },
  { forum: 3, by: "nova", title: "Show us your raised beds", replies: ["kestrel", "wren"] },
];
const created: { threadId: number; postId: number }[] = [];
for (const spec of threads) {
  const made = await run<{ thread: Created; post: Created }>("threads.create", spec.by, {
    nodeId: forums[spec.forum],
    title: spec.title,
    body: `I would like to hear how others handle this: ${spec.title.toLowerCase()}.`,
  });
  created.push({ threadId: made.thread.id, postId: made.post.id });
  for (const by of spec.replies)
    await run("posts.create", by, {
      threadId: made.thread.id,
      body: `Thanks for raising this. My experience is that patience and good soil go a long way.`,
    });
}

await run("threads.setSticky", "nova", { threadId: created[1]!.threadId, isSticky: true });
await run("threads.setLocked", "kestrel", { threadId: created[3]!.threadId, isLocked: true });
await run("reactions.set", "wren", {
  contentType: "post",
  contentId: created[0]!.postId,
  reactionTypeId: REACTION.like,
});
await run("reactions.set", "ember", {
  contentType: "post",
  contentId: created[2]!.postId,
  reactionTypeId: REACTION.love,
});
await run("conversations.create", "ember", {
  title: "Seed swap",
  recipientIds: [ids.wren],
  body: "I have too many sunflower seeds. Would you like some?",
});

// New-member rules may have queued content; the administrator approves it rather than the
// fixture changing the settings.
const queue = await run<{ items: { type: "thread" | "post"; id: number }[] }>(
  "approvals.list",
  "nova",
  { limit: 100 },
);
if (queue.items.length)
  await run("moderation.bulk", "nova", {
    targets: queue.items.map(({ type, id }) => ({ type, id })),
    action: "approve",
  });

closeContext(ctx);
console.log(`Fixture loaded into ${config.path}.`);
console.log(`Members: nova (administrator), kestrel (moderator), ember, wren.`);
console.log(`Password for all four: ${password}`);
