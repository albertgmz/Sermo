import * as z from "zod";
import type { Actor } from "./actor";
import type { Ctx } from "./context";
import { ValidationError } from "./errors";

/**
 * A contract describes one operation: its name, whether it reads or writes, and its input and
 * output schemas. Contracts live in `src/contracts/` and are the single source for REST routes,
 * the OpenAPI document, MCP tool definitions and benchmarks.
 */
export interface Contract<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  /** Dotted name, e.g. "threads.create". Unique. */
  readonly name: string;
  readonly summary: string;
  readonly kind: "read" | "write";
  readonly input: I;
  readonly output: O;
}

/** A contract plus its implementation. `run` receives already-parsed input. */
export interface Operation<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType>
  extends Contract<I, O> {
  readonly run: (ctx: Ctx, actor: Actor, input: z.output<I>) => z.input<O> | Promise<z.input<O>>;
  /** Why this operation needs no permission check, when it is deliberately open to anyone. */
  readonly public?: string;
}

// biome-ignore lint/suspicious/noExplicitAny: heterogeneous registry of operations
export type AnyOperation = Operation<any, any>;

export function defineContract<I extends z.ZodType, O extends z.ZodType>(
  contract: Contract<I, O>,
): Contract<I, O> {
  return contract;
}

/**
 * Pairs a contract with its implementation. The run function must decide through the permission
 * check (src/permissions); an operation open to anyone says so with `{ public: "<why>" }`. The
 * permission coverage test enforces this.
 */
export function implement<I extends z.ZodType, O extends z.ZodType>(
  contract: Contract<I, O>,
  run: Operation<I, O>["run"],
  options: { public?: string } = {},
): Operation<I, O> {
  return { ...contract, run, ...(options.public ? { public: options.public } : {}) };
}

/**
 * Marks an exported service function that takes an actor but deliberately makes no permission
 * decision (a helper whose callers decide). Returns `fn` unchanged; the permission coverage test
 * recognises the marker.
 */
export function markPublic<T extends (...args: never[]) => unknown>(_reason: string, fn: T): T {
  return fn;
}

/**
 * Parses raw input against the contract, runs the operation and (when configured) validates the
 * output. Adapters and other external callers go through this; it is the one entry point that
 * guarantees input validation.
 */
export async function execute<I extends z.ZodType, O extends z.ZodType>(
  ctx: Ctx,
  op: Operation<I, O>,
  actor: Actor,
  rawInput: unknown,
): Promise<z.output<O>> {
  const parsed = op.input.safeParse(rawInput ?? {});
  if (!parsed.success) throw zodToValidationError(parsed.error);
  const result = await op.run(ctx, actor, parsed.data);
  if (ctx.config.validateOutput) {
    const checked = op.output.safeParse(result);
    if (!checked.success) {
      throw new Error(
        `Operation ${op.name} returned output that violates its contract:\n${z.prettifyError(checked.error)}`,
      );
    }
    return checked.data;
  }
  return result as z.output<O>;
}

export function zodToValidationError(error: z.ZodError): ValidationError {
  return new ValidationError(
    "The request is invalid.",
    error.issues.map((issue) => ({
      path: issue.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
      message: issue.message,
    })),
  );
}
