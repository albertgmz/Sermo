import { expect, test } from "bun:test";
import { createTestContext, insertNode } from "@sermo/core/testing";
import { invalidate } from "../../context";
import { traceStatements } from "../statement-trace";
import { threadPresenter } from "./presentation";

test("a page with no prefix and no cover reads neither the prefix list nor the catalogs", () => {
  const ctx = createTestContext();
  const trace = traceStatements(ctx);
  const forum = insertNode(ctx, { type: "forum" });
  invalidate(ctx, "node_tree");
  // Warm every cache so only the version checks remain.
  const warm = threadPresenter(ctx);
  warm.node(forum.id);
  warm.prefix(1);
  warm.cover(1);
  const versions = () => trace.count(/cache_versions/);
  const before = versions();
  const presenter = threadPresenter(ctx);
  const treeOnly = versions() - before;
  expect(presenter.node(forum.id)).toEqual({ id: forum.id, title: expect.any(String) });
  expect(presenter.prefix(null)).toBeNull();
  expect(presenter.cover(null)).toBeNull();
  expect(versions() - before).toBe(treeOnly);
  presenter.prefix(1);
  expect(versions() - before).toBeGreaterThan(treeOnly);
  const afterPrefix = versions();
  presenter.cover(1);
  expect(versions()).toBeGreaterThan(afterPrefix);
});
