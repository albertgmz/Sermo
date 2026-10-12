import { expect, test } from "bun:test";
import type * as z from "zod";
import type { Actor } from "../actor";
import { closeContext } from "../context";
import type { ShopItem } from "../contracts/shop";
import { CREDIT_TRIGGERS } from "../db/schema";
import { ConflictError } from "../errors";
import { insertCatalogImage, insertPaletteColor } from "../modules/appearance/catalog-fixtures";
import { getAuth } from "../modules/auth";
import { flushActivity } from "../modules/jobs/queue";
import { userActor } from "../testing";
import {
  assertInvariants,
  databaseSnapshot,
  drainEvents,
  drainJobs,
  expire,
  random,
  replayTwice,
  rows,
  setup,
} from "./helpers";

type Content = { id: number; author: Actor; visible: boolean };

for (const seed of [0x12345678, 0x51a7e, 0xdecafbad]) {
  test(`economy invariants after 280 mixed steps, seed ${seed}`, async () => {
    const { ctx, act, members, moderator, node, stocks } = setup();
    try {
      const rng = random(seed);
      const pick = <T>(values: readonly T[]): T => values[rng(values.length)]!;
      const member = () => pick(members);
      const actors = members.map(userActor);
      const mod = userActor(moderator);
      const ruleIds = new Map<string, number>();
      for (const trigger of CREDIT_TRIGGERS) {
        const rule = await act("creditRules.create", {
          title: trigger,
          trigger,
          amount: trigger === "warning_received" ? -7 : 3,
        });
        ruleIds.set(trigger, rule.id);
      }
      for (const user of members)
        await act("credits.adjust", {
          userId: user.id,
          amount: 500,
          reason: "Initial ledger-backed budget",
        });
      for (const user of members)
        await act("permissions.set", {
          userId: user.id,
          entries: [
            { permission: "forum.deleteAny", value: "allow" },
            { permission: "forum.viewDeleted", value: "allow" },
          ],
        });
      const category = await act("shopCategories.create", { name: "Sequence items" });
      const items: z.infer<typeof ShopItem>[] = [];
      for (const spec of [
        {
          name: "Consumable",
          isConsumable: true,
          effect: { type: "frame", frameId: insertCatalogImage(ctx, "frame") },
        },
        { name: "Permanent", effect: { type: "nameColor", colorId: insertPaletteColor(ctx) } },
        {
          name: "Temporary",
          durationSeconds: 60,
          effect: { type: "frame", frameId: insertCatalogImage(ctx, "frame") },
        },
        {
          name: "Permission units",
          isConsumable: true,
          effect: { type: "permission", permission: "forum.bypassNodeRules" },
        },
        { name: "Temporary group", durationSeconds: 60, effect: { type: "group", groupId: 2 } },
        {
          name: "Permanent permission",
          effect: { type: "permission", permission: "profile.bypassPrivacy" },
        },
      ]) {
        const item = await act("shopItems.create", {
          categoryId: category.id,
          price: 5,
          stock: 60,
          isGiftable: true,
          ...spec,
        });
        items.push(item);
        stocks.set(item.id, 60);
      }
      const stackable = await act("awards.create", {
        name: "Stackable",
        tier: "bronze",
        xp: 4,
        credits: 8,
        isStackable: true,
      });
      const unique = await act("awards.create", {
        name: "Unique",
        tier: "silver",
        xp: 6,
        credits: 11,
      });
      const automatic = await act("awards.create", {
        name: "Buyer achievement",
        tier: "gold",
        xp: 10,
        credits: 13,
        criteria: [{ criterion: "purchases_at_least", value: 1 }],
      });
      const reaction = await act("reactionTypes.create", {
        title: "Sequence reaction",
        emoji: "+",
        score: 1,
      });
      const anchor = await act(
        "threads.create",
        { nodeId: node.id, title: "Always visible parent", body: "Anchor" },
        actors[0],
      );
      const threads: Content[] = [];
      const posts: Content[] = [];
      const profiles: Content[] = [];
      const createThread = async () => {
        const author = pick(actors);
        const result = await act(
          "threads.create",
          { nodeId: node.id, title: `Thread ${threads.length}`, body: "Rewarded thread" },
          author,
        );
        threads.push({ id: result.thread.id, author, visible: true });
      };
      const createPost = async () => {
        const author = pick(actors);
        const result = await act(
          "posts.create",
          { threadId: anchor.thread.id, body: "Rewarded reply" },
          author,
        );
        posts.push({ id: result.id, author, visible: true });
      };
      const createProfile = async () => {
        const author = actors[0]!;
        const result = await act(
          "profilePosts.create",
          { userId: members[1]!.id, body: "Rewarded profile post" },
          author,
        );
        profiles.push({ id: result.id, author, visible: true });
      };
      const toggle = async (values: Content[], prefix: string, key: string) => {
        const source = pick(values);
        // Members delete their own content; moderators can both delete and restore it.
        const actor = source.visible && rng(2) === 0 ? source.author : mod;
        await act(
          `${prefix}.${source.visible ? "delete" : "restore"}`,
          { [key]: source.id },
          actor,
        );
        source.visible = !source.visible;
      };
      const buy = async (index: number, gift = false) => {
        const item = items[index]!;
        const user = member();
        const recipient = gift ? pick(members.filter((other) => other.id !== user.id)) : user;
        const quantity = item.isConsumable ? 1 + rng(3) : 1;
        const balance = rows<{ credits: number }>(
          ctx,
          "SELECT credits FROM users WHERE id = ?1",
          user.id,
        )[0]!.credits;
        const stock = rows<{ stock: number }>(
          ctx,
          "SELECT stock FROM shop_items WHERE id = ?1",
          item.id,
        )[0]!.stock;
        const inventory = rows<{ state: string; expires_at: number | null }>(
          ctx,
          "SELECT state, expires_at FROM shop_inventory WHERE item_id = ?1 AND user_id = ?2",
          item.id,
          recipient.id,
        )[0];
        const shouldFail =
          balance < item.price * quantity ||
          stock < quantity ||
          (!item.isConsumable &&
            inventory !== undefined &&
            inventory.state !== "expired" &&
            // A row whose time has lapsed counts as expired before the job marks it.
            !(inventory.expires_at !== null && inventory.expires_at <= ctx.now()));
        const before = databaseSnapshot(ctx);
        const purchase = () =>
          act(
            "shop.buy",
            { itemId: item.id, quantity, recipientId: recipient.id },
            userActor(user),
          );
        if (shouldFail) {
          await expect(purchase()).rejects.toBeInstanceOf(ConflictError);
          expect(databaseSnapshot(ctx), "failed random purchase must roll back completely").toEqual(
            before,
          );
        } else {
          const result = await purchase();
          expect(result.balance).toBe(balance - item.price * quantity);
          expect(result.purchase.quantity).toBe(quantity);
          expect(result.purchase.price).toBe(item.price * quantity);
        }
      };

      // Guaranteed coverage before randomized ordering, including the two non-content triggers.
      const { user: registered } = await getAuth(ctx).api.signUpEmail({
        body: {
          name: "Registered member",
          username: `sequence_${seed}`,
          email: `sequence_${seed}@example.test`,
          password: "password123",
        },
      });
      expect(Number(registered.id)).toBeGreaterThan(0);
      await createThread();
      await createPost();
      await createProfile();
      await act(
        "posts.create",
        { threadId: anchor.thread.id, body: "Someone else's reply" },
        actors[1],
      );
      await act(
        "reactions.set",
        { contentType: "post", contentId: anchor.post.id, reactionTypeId: reaction.id },
        actors[1],
      );
      await act("users.follow", { userId: members[0]!.id }, actors[1]);
      await act("warnings.create", {
        userId: members[0]!.id,
        points: 1,
        reason: "Sequence warning",
        expiresAt: new Date(ctx.now() + 1000).toISOString(),
      });
      await act("awards.grant", { userId: members[0]!.id, awardId: stackable.id });
      ctx.activity.set(members[0]!.id, ctx.now());
      flushActivity(ctx);
      await buy(0);
      await drainEvents(ctx);
      assertInvariants(ctx, stocks);
      expect(
        rows<{ trigger: string }>(
          ctx,
          `SELECT DISTINCT r.trigger FROM credit_rule_applications a
        JOIN credit_rules r ON r.id = a.rule_id ORDER BY r.trigger`,
        ).map((row) => row.trigger),
      ).toEqual([...CREDIT_TRIGGERS].sort());
      expect(
        rows(
          ctx,
          "SELECT id FROM member_awards WHERE award_id = ?1 AND granted_by IS NULL",
          automatic.id,
        ).length,
      ).toBeGreaterThan(0);

      const actions: { name: string; run: () => unknown }[] = [
        {
          name: "adjust",
          run: () =>
            act("credits.adjust", {
              userId: member().id,
              amount: rng(2) ? 9 : -7,
              reason: "Seeded movement",
            }),
        },
        { name: "thread create", run: createThread },
        { name: "post create", run: createPost },
        { name: "profile create", run: createProfile },
        { name: "thread visibility", run: () => toggle(threads, "threads", "threadId") },
        { name: "post visibility", run: () => toggle(posts, "posts", "postId") },
        {
          name: "profile visibility",
          run: () => toggle(profiles, "profilePosts", "profilePostId"),
        },
        {
          name: "reaction set",
          run: () =>
            act(
              "reactions.set",
              { contentType: "post", contentId: anchor.post.id, reactionTypeId: reaction.id },
              pick(actors.slice(1)),
            ),
        },
        {
          name: "reaction remove",
          run: () =>
            act(
              "reactions.remove",
              { contentType: "post", contentId: anchor.post.id },
              pick(actors.slice(1)),
            ),
        },
        {
          name: "follow",
          run: () => act("users.follow", { userId: members[0]!.id }, pick(actors.slice(1))),
        },
        {
          name: "unfollow",
          run: () => act("users.unfollow", { userId: members[0]!.id }, pick(actors.slice(1))),
        },
        {
          name: "warning",
          run: () =>
            act("warnings.create", {
              userId: member().id,
              points: 1,
              reason: "Warning",
              expiresAt: new Date(ctx.now() + 1000).toISOString(),
            }),
        },
        {
          name: "stackable grant",
          run: () => act("awards.grant", { userId: member().id, awardId: stackable.id }),
        },
        {
          name: "unique grant",
          run: async () => {
            const user = member();
            const held = rows(
              ctx,
              "SELECT id FROM member_awards WHERE user_id = ?1 AND award_id = ?2 AND revoked_at IS NULL",
              user.id,
              unique.id,
            );
            if (held.length) {
              const before = databaseSnapshot(ctx);
              await expect(
                act("awards.grant", { userId: user.id, awardId: unique.id }),
              ).rejects.toBeInstanceOf(ConflictError);
              expect(databaseSnapshot(ctx)).toEqual(before);
            } else await act("awards.grant", { userId: user.id, awardId: unique.id });
          },
        },
        {
          name: "award revoke",
          run: async () => {
            const held = rows<{ id: number }>(
              ctx,
              "SELECT id FROM member_awards WHERE revoked_at IS NULL ORDER BY id",
            );
            if (held.length) await act("awards.revoke", { memberAwardId: pick(held).id });
          },
        },
        ...items.map((item, index) => ({ name: `buy ${item.name}`, run: () => buy(index) })),
        { name: "gift", run: () => buy(rng(items.length), true) },
        {
          name: "use",
          run: async () => {
            const held = rows<{ id: number; user_id: number }>(
              ctx,
              "SELECT inv.id, inv.user_id FROM shop_inventory inv JOIN shop_items it ON it.id = inv.item_id WHERE inv.state = 'unused' AND inv.quantity > 0 AND json_extract(it.effect, '$.type') = 'permission' ORDER BY inv.id",
            );
            if (held.length) {
              const inventory = pick(held);
              await act(
                "shop.use",
                { inventoryId: inventory.id },
                userActor(members.find((user) => user.id === inventory.user_id)!),
              );
            }
          },
        },
        {
          name: "expiry",
          run: async () => {
            ctx.clock.advance(60_000);
            await expire(ctx);
          },
        },
        {
          name: "rule edit or delete",
          run: async () => {
            const trigger = pick(CREDIT_TRIGGERS);
            const id = ruleIds.get(trigger)!;
            if (rng(3) === 0) {
              await act("creditRules.delete", { ruleId: id });
              const next = await act("creditRules.create", {
                title: trigger,
                trigger,
                amount: 2 + rng(8),
              });
              expect(next.id).toBeGreaterThan(id);
              ruleIds.set(trigger, next.id);
            } else
              await act("creditRules.update", {
                ruleId: id,
                amount: rng(2) ? 17 : -5,
                isActive: rng(4) !== 0,
              });
          },
        },
        {
          name: "automatic award job",
          run: async () => {
            await act("awards.run");
            await drainJobs(ctx);
          },
        },
        {
          name: "daily activity",
          run: () => {
            ctx.clock.advance(86_400_000);
            ctx.activity.set(member().id, ctx.now());
            flushActivity(ctx);
          },
        },
        {
          name: "award edit",
          run: () =>
            act("awards.update", {
              awardId: pick([unique.id, stackable.id]),
              xp: rng(20),
              credits: rng(20),
            }),
        },
      ];
      const coverage = new Set<string>();
      let deck: typeof actions = [];
      for (let step = 0; step < 280; step++) {
        if (deck.length === 0) {
          deck = [...actions];
          for (let i = deck.length - 1; i > 0; i--) {
            const j = rng(i + 1);
            [deck[i], deck[j]] = [deck[j]!, deck[i]!];
          }
        }
        const action = deck.pop()!;
        coverage.add(action.name);
        ctx.clock.advance(2000);
        try {
          await action.run();
          if (rng(4) === 0 || step % 7 === 0 || step === 279) {
            await drainEvents(ctx);
            assertInvariants(ctx, stocks);
          }
        } catch (error) {
          throw new Error(`seed=${seed}, step=${step}, action=${action.name}`, { cause: error });
        }
      }
      expect([...coverage].sort()).toEqual(actions.map((action) => action.name).sort());
      await replayTwice(ctx, stocks);
    } finally {
      closeContext(ctx);
    }
  }, 15_000);
}
