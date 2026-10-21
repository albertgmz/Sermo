import { join } from "node:path";

// The parts of `grant-manual-awards.ts` that the test drives: the holders file, the arguments, and
// the run itself, which talks to the API only through an injected `fetch`.

export const MAX_WRITES_PER_SECOND = 3;
export const GRANT_REASON = "Trofeo de XenForo";
const MAX_RATE_LIMIT_WAITS = 5;
const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;

export interface AwardHolders {
  name: string;
  xenforoTrophyId: number;
  userIds: number[];
}

export function parseHolders(text: string): AwardHolders[] {
  const data = JSON.parse(text) as { awards?: unknown };
  if (!Array.isArray(data.awards) || data.awards.length === 0)
    throw new Error("The holders file has no awards.");
  return data.awards.map((entry: unknown, index) => {
    const award = entry as Partial<AwardHolders> | null;
    const ids = award?.userIds;
    if (
      typeof award?.name !== "string" ||
      !award.name ||
      !Number.isInteger(award.xenforoTrophyId) ||
      !Array.isArray(ids) ||
      !ids.every((id) => Number.isInteger(id) && id > 0)
    )
      throw new Error(`Award ${index + 1} of the holders file is malformed.`);
    return {
      name: award.name,
      xenforoTrophyId: award.xenforoTrophyId as number,
      userIds: [...new Set(ids as number[])],
    };
  });
}

export interface Options {
  holdersFile: string;
  url: string;
  dryRun: boolean;
  perSecond: number;
}

export function parseArgs(argv: string[]): Options {
  const options: Options = {
    holdersFile: join(import.meta.dir, "manual-award-holders.json"),
    url: "https://fcuba.net",
    dryRun: false,
    perSecond: MAX_WRITES_PER_SECOND,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = () => {
      const next = argv[++i];
      if (!next) throw new Error(`${arg} needs a value.`);
      return next;
    };
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--holders") options.holdersFile = value();
    else if (arg === "--url") options.url = value();
    else if (arg === "--rate") {
      options.perSecond = Number(value());
      if (!(options.perSecond > 0) || options.perSecond > MAX_WRITES_PER_SECOND)
        throw new Error(
          `--rate must be above 0 and at most ${MAX_WRITES_PER_SECOND} writes a second.`,
        );
    } else
      throw new Error(
        `Unknown argument ${arg}. Usage: [--dry-run] [--rate n] [--url u] [--holders file]`,
      );
  }
  return options;
}

export type Credentials = { apiKey: string } | { cookie: string };

/** The credential comes from the environment, never from an argument or a file. */
export function credentialsFrom(env: Record<string, string | undefined>): Credentials {
  const apiKey = env.SERMO_API_KEY?.trim();
  const cookie = env.SERMO_SESSION_COOKIE?.trim();
  if (apiKey && cookie) throw new Error("Set SERMO_API_KEY or SERMO_SESSION_COOKIE, not both.");
  if (apiKey) return { apiKey };
  if (cookie) return { cookie };
  throw new Error("Set SERMO_API_KEY (an administrator's API key) or SERMO_SESSION_COOKIE.");
}

export interface Dependencies {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

export interface AwardSummary {
  name: string;
  holders: number;
  granted: number;
  /** Dry run: grants that would be made. */
  pending: number;
  alreadyHeld: number;
  refused: number;
  failed: number;
}

class Aborted extends Error {}

export async function grantManualAwards(
  options: Pick<Options, "url" | "dryRun" | "perSecond">,
  credentials: Credentials,
  holders: AwardHolders[],
  deps: Dependencies,
): Promise<AwardSummary[]> {
  const base = options.url.replace(/\/+$/, "");
  const origin = new URL(base).origin;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "sermo-grant-manual-awards",
    ...("apiKey" in credentials
      ? { "x-api-key": credentials.apiKey }
      : { cookie: credentials.cookie, origin }),
  };
  const gap = 1000 / options.perSecond;
  let lastWrite = Number.NEGATIVE_INFINITY;

  const call = async (method: string, path: string, body?: object): Promise<Response> => {
    for (let waits = 0; ; waits++) {
      if (method !== "GET") {
        const wait = lastWrite + gap - performance.now();
        if (wait > 0) await deps.sleep(wait);
        lastWrite = performance.now();
      }
      const response = await deps.fetch(`${base}/api/v1${path}`, {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (response.status === 401 || response.status === 403)
        throw new Aborted(
          `${method} ${path} answered ${response.status}: the credential cannot grant awards.`,
        );
      if (response.status !== 429) return response;
      if (waits >= MAX_RATE_LIMIT_WAITS) throw new Aborted("The API keeps answering 429.");
      const seconds = Number(
        response.headers.get("retry-after") ?? response.headers.get("ratelimit-reset"),
      );
      const delay = seconds > 0 ? seconds * 1000 : DEFAULT_RATE_LIMIT_WAIT_MS;
      deps.log(`  rate limited; waiting ${Math.ceil(delay / 1000)} s`);
      await deps.sleep(delay);
    }
  };
  const read = async <T>(path: string): Promise<T> => {
    const response = await call("GET", path);
    if (!response.ok) throw new Aborted(`GET ${path} answered ${response.status}.`);
    return (await response.json()) as T;
  };

  const catalog = await read<{ items: { id: number; name: string; isActive: boolean }[] }>(
    "/awards",
  );
  const resolved = holders.map((holder) => {
    const matches = catalog.items.filter((award) => award.name === holder.name);
    if (matches.length !== 1)
      throw new Aborted(
        `${matches.length} awards are named "${holder.name}"; expected exactly one.`,
      );
    if (!matches[0]!.isActive) throw new Aborted(`The award "${holder.name}" is inactive.`);
    return { holder, awardId: matches[0]!.id };
  });

  const summaries: AwardSummary[] = [];
  for (const { holder, awardId } of resolved) {
    const summary: AwardSummary = {
      name: holder.name,
      holders: holder.userIds.length,
      granted: 0,
      pending: 0,
      alreadyHeld: 0,
      refused: 0,
      failed: 0,
    };
    summaries.push(summary);
    const held = new Set<number>();
    for (let cursor: string | null = null; ; ) {
      const page: {
        items: { user: { id: number } }[];
        nextCursor: string | null;
      } = await read(`/awards/${awardId}/holders?limit=100${cursor ? `&cursor=${cursor}` : ""}`);
      for (const grant of page.items) held.add(grant.user.id);
      if (!page.nextCursor) break;
      cursor = encodeURIComponent(page.nextCursor);
    }
    deps.log(
      `${holder.name} (award ${awardId}): ${holder.userIds.length} holders, ${held.size} held`,
    );
    for (const userId of holder.userIds) {
      if (held.has(userId)) {
        summary.alreadyHeld++;
        continue;
      }
      if (options.dryRun) {
        summary.pending++;
        deps.log(`  would grant to member ${userId}`);
        continue;
      }
      let response: Response;
      try {
        response = await call("POST", `/users/${userId}/awards`, {
          awardId,
          reason: GRANT_REASON,
        });
      } catch (error) {
        if (error instanceof Aborted) throw error;
        summary.failed++;
        deps.log(`  member ${userId}: ${(error as Error).message}`);
        continue;
      }
      if (response.status === 201) {
        summary.granted++;
        continue;
      }
      const message =
        ((await response.json().catch(() => null)) as { error?: { message?: string } } | null)
          ?.error?.message ?? "";
      if (response.status === 409 && /already holds/.test(message)) summary.alreadyHeld++;
      else if (response.status >= 400 && response.status < 500) {
        summary.refused++;
        deps.log(`  member ${userId}: ${response.status} ${message}`);
      } else {
        summary.failed++;
        deps.log(`  member ${userId}: ${response.status} ${message}`);
      }
    }
  }
  return summaries;
}

export function formatSummary(summaries: AwardSummary[], dryRun: boolean): string {
  const lines = summaries.map(
    (s) =>
      `${s.name}: ${s.holders} holders, ${dryRun ? `${s.pending} to grant` : `${s.granted} granted`}, ` +
      `${s.alreadyHeld} already held, ${s.refused} refused, ${s.failed} failed`,
  );
  return lines.join("\n");
}
