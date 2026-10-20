import * as z from "zod";
import type { Actor } from "./actor";
import { approvalPending } from "./approval";
import type { Ctx } from "./context";
import { ForbiddenError, UnauthenticatedError, ValidationError } from "./errors";

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
  // An account that waits for approval takes no write, whatever the operation checks: only the
  // operations open to anyone (own sign-out-like removals, accepting the terms) are left, and
  // leaving the forum.
  if (
    op.kind === "write" &&
    !op.public &&
    op.name !== "users.deleteOwnAccount" &&
    actor.kind !== "guest" &&
    actor.principal?.awaitingApproval
  )
    throw approvalPending();
  const parsed = op.input.safeParse(rawInput ?? {});
  if (!parsed.success)
    return refuseBeforeValidating(ctx, op, actor, zodToValidationError(parsed.error));
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

/** Thrown by the stand-in input when an operation reads it. */
class InputRead extends Error {}

/** An input that refuses to be read: any property access, `in`, spread or destructuring throws. */
const unreadable = new Proxy(
  {},
  {
    get: () => {
      throw new InputRead();
    },
    has: () => {
      throw new InputRead();
    },
    ownKeys: () => {
      throw new InputRead();
    },
    getOwnPropertyDescriptor: () => {
      throw new InputRead();
    },
  },
);

/** What the race below answers when the operation has not finished or refused yet. */
const UNDECIDED = Symbol("undecided");

/**
 * The answer to input that does not validate: a caller the operation refuses whatever it sent (a
 * guest where an account is needed, a member without the permission) gets that 401 or 403, the
 * same refusal valid input would get, instead of a 400 that depends on what was sent. The routes
 * and their parameters are public (the OpenAPI document, the MCP tool list, the API reference
 * page), so this hides nothing; it makes the order of the checks the same on every route.
 *
 * The operation decides, by running it against an input it cannot read: the checks that come
 * before its first read of the input are the ones that do not depend on it. An unauthenticated or
 * forbidden refusal raised before that point is thrown; reaching the input, any other error or
 * finishing without reading it throws `invalid` as before. An operation whose permission depends
 * on the input (an own item, a node, a target member) reads it first and so still validates
 * first.
 *
 * Only what the operation does before its first `await` counts. The connection is read-only while
 * that part runs, so a write there fails and the answer is `invalid`. An operation that has not
 * refused by then (it is waiting on something) is not decided: the answer is `invalid` and the
 * rest of its run is not waited for. That rest cannot be stopped, so an operation must check the
 * caller and read its input before it writes or awaits anything it must not repeat;
 * `operation.test.ts` runs the probe of every operation as a guest, a member and an
 * administrator and fails if one changes the database or the in-memory buffers. The flag is set
 * and cleared around the call, so a probe started inside another probe's synchronous part would
 * clear it early; no operation calls `execute` from inside `run`.
 */
export async function refuseBeforeValidating(
  ctx: Ctx,
  op: AnyOperation,
  actor: Actor,
  invalid: ValidationError,
): Promise<never> {
  let outcome: unknown;
  ctx.sqlite.run("PRAGMA query_only = 1");
  try {
    outcome = op.run(ctx, actor, unreadable);
  } catch (error) {
    outcome = Promise.reject(error);
  } finally {
    ctx.sqlite.run("PRAGMA query_only = 0");
  }
  try {
    // A promise that is already settled wins the race, so a refusal raised before the first
    // `await` is seen and one that comes later is not.
    const settled = await Promise.race([outcome, Promise.resolve(UNDECIDED)]);
    if (settled === UNDECIDED) Promise.resolve(outcome).catch(() => undefined);
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof ForbiddenError) throw error;
  }
  throw invalid;
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
