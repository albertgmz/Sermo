import type { Ctx } from "../context";

/**
 * Records the SQL of every statement the context executes from now on. Install it right after
 * the context is made: a statement is traced from the moment it is prepared, and prepared
 * statements are cached for the context's life.
 */
export function traceStatements(ctx: Ctx): { sql: string[]; count(pattern?: RegExp): number } {
  const sql: string[] = [];
  const originalPrepare = ctx.sqlite.prepare.bind(ctx.sqlite);
  const originalQuery = ctx.sqlite.query.bind(ctx.sqlite);
  const track = (text: string, statement: object) => {
    for (const method of ["get", "all", "run"] as const) {
      const original = Reflect.get(statement, method) as (...args: unknown[]) => unknown;
      Reflect.set(statement, method, (...args: unknown[]) => {
        sql.push(text);
        return Reflect.apply(original, statement, args);
      });
    }
    return statement;
  };
  Reflect.set(ctx.sqlite, "prepare", (text: string) => track(text, originalPrepare(text)));
  Reflect.set(ctx.sqlite, "query", (text: string) => track(text, originalQuery(text)));
  return {
    sql,
    count: (pattern) => (pattern ? sql.filter((text) => pattern.test(text)) : sql).length,
  };
}
