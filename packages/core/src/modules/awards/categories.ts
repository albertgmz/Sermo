import type * as z from "zod";
import type { Actor } from "../../actor";
import type { Ctx } from "../../context";
import * as contracts from "../../contracts/awards";
import { writeTx } from "../../db/tx";
import { NotFoundError, ValidationError } from "../../errors";
import { implement } from "../../operation";
import { can, currentActor, requirePermission } from "../../permissions";
import { iso } from "../../time";
import { requireSiteView } from "../members/site-access";
import { appendModeratorLog } from "../moderation";
import { all, one, run } from "./store";

type CategoryRow = {
  id: number;
  title: string;
  description: string;
  position: number;
  award_count: number;
  created_at: number;
  updated_at: number;
};

// `?1` is 1 when inactive awards are counted too (for award managers).
const counted =
  "SELECT c.*, (SELECT COUNT(*) FROM awards a WHERE a.category_id = c.id AND (a.is_active = 1 OR ?1 = 1)) AS award_count FROM award_categories c";
export const categorySql = {
  list: `${counted} ORDER BY c.position, c.id`,
  category: `${counted} WHERE c.id = ?2`,
  exists: "SELECT id FROM award_categories WHERE id = ?1",
  // After the last one; ties at the highest position are ordered by id, so a new one still ends last.
  next: "SELECT MIN(COALESCE(MAX(position) + 1, 0), 1000000) AS position FROM award_categories",
};

const categoryValue = (row: CategoryRow): z.infer<typeof contracts.AwardCategory> => ({
  id: row.id,
  title: row.title,
  description: row.description,
  position: row.position,
  awardCount: row.award_count,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});
function categoryRow(ctx: Ctx, id: number): CategoryRow {
  const row = one<CategoryRow>(ctx, "category", categorySql.category, 1, id);
  if (!row) throw new NotFoundError();
  return row;
}
/** For an award's form: an unknown category is a mistake in the field, not a missing award. */
export function assertCategory(ctx: Ctx, categoryId: number | null): void {
  if (categoryId === null || one(ctx, "categoryExists", categorySql.exists, categoryId)) return;
  const message = "categoryId: there is no award category with that id.";
  throw new ValidationError(message, [{ path: ["categoryId"], message }]);
}
function manager(ctx: Ctx, actor: Actor): void {
  requirePermission(ctx, currentActor(ctx, actor), "admin.awards");
}

export const categoryOperations = [
  implement(contracts.awardCategoriesList, (ctx, actor) => {
    requireSiteView(ctx, actor);
    requirePermission(ctx, actor, "profile.view");
    const admin = Number(can(ctx, actor, "admin.awards"));
    return {
      items: all<CategoryRow>(ctx, "categories", categorySql.list, admin).map(categoryValue),
    };
  }),
  implement(contracts.awardCategoriesCreate, (ctx, actor, input) => {
    requirePermission(ctx, actor, "admin.awards");
    return writeTx(ctx, () => {
      manager(ctx, actor);
      const position =
        input.position ??
        one<{ position: number }>(ctx, "categoryNext", categorySql.next)!.position;
      const id = Number(
        run(
          ctx,
          "categoryCreate",
          "INSERT INTO award_categories (title, description, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
          input.title,
          input.description,
          position,
          ctx.now(),
        ).lastInsertRowid,
      );
      appendModeratorLog(ctx, actor, "awardCategory.create", "award_category", id, "", {
        title: input.title,
      });
      return categoryValue(categoryRow(ctx, id));
    });
  }),
  implement(contracts.awardCategoriesUpdate, (ctx, actor, input) => {
    requirePermission(ctx, actor, "admin.awards");
    return writeTx(ctx, () => {
      manager(ctx, actor);
      const row = categoryRow(ctx, input.categoryId);
      run(
        ctx,
        "categoryUpdate",
        "UPDATE award_categories SET title = ?1, description = ?2, position = ?3, updated_at = ?4 WHERE id = ?5",
        input.title ?? row.title,
        input.description ?? row.description,
        input.position ?? row.position,
        ctx.now(),
        row.id,
      );
      appendModeratorLog(ctx, actor, "awardCategory.update", "award_category", row.id, "", {
        changedKeys: Object.keys(input).filter((key) => key !== "categoryId"),
      });
      return categoryValue(categoryRow(ctx, row.id));
    });
  }),
  implement(contracts.awardCategoriesDelete, (ctx, actor, input) => {
    requirePermission(ctx, actor, "admin.awards");
    return writeTx(ctx, () => {
      manager(ctx, actor);
      const row = categoryRow(ctx, input.categoryId);
      // The foreign key leaves its awards without a category.
      run(ctx, "categoryDelete", "DELETE FROM award_categories WHERE id = ?1", row.id);
      appendModeratorLog(ctx, actor, "awardCategory.delete", "award_category", row.id, "", {
        title: row.title,
        awards: row.award_count,
      });
      return { ok: true as const };
    });
  }),
];
