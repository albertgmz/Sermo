import { expect, test } from "bun:test";
import { createTestContext } from "@sermo/core/testing";
import { writeTx } from "../db/tx";
import { traceStatements } from "./statement-trace";

test("the trace sees every way a statement is run, and whether a transaction was open", () => {
  const ctx = createTestContext();
  const trace = traceStatements(ctx);
  const select = ctx.sqlite.prepare<{ n: number }, []>("SELECT 1 AS n /* prepared */");
  select.get();
  select.all();
  select.values();
  for (const _ of select.iterate()) break;
  ctx.sqlite.prepare("SELECT 2 /* run */").run();
  ctx.sqlite.query("SELECT 3 /* query */").get();
  ctx.sqlite.run("SELECT 4 /* db.run */");
  ctx.sqlite.exec("SELECT 5 /* db.exec */");
  writeTx(ctx, () => ctx.sqlite.prepare("SELECT 6 /* inside */").get());
  expect(trace.count(/prepared/)).toBe(4);
  for (const mark of ["run", "query", "db.run", "db.exec", "inside"])
    expect(trace.sql.filter((text) => text.includes(`/* ${mark} */`))).toHaveLength(1);
  const inside = trace.sql.findIndex((text) => text.includes("inside"));
  expect(trace.inTransaction[inside]).toBe(true);
  expect(trace.inTransaction.filter(Boolean)).toHaveLength(1);
});
