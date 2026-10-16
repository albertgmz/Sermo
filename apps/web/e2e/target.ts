// Where the suite runs and who it signs in as. The local dev fixture (`bun run dev:fixture`) is
// the default target; any other address must name its members, so a run against staging never
// quietly uses accounts that are not there.
export const DEFAULT_BASE_URL = "http://localhost:3000";
export const BASE_URL = process.env.E2E_BASE_URL ?? DEFAULT_BASE_URL;

const FIXTURE = {
  E2E_USER: "ember",
  E2E_PEER: "wren",
  E2E_PASSWORD: "sermo-dev-password",
} as const;

// Stops the run, before any test, when another site is the target and a name or the password is
// missing.
export function requireCredentials() {
  if (BASE_URL === DEFAULT_BASE_URL) return;
  const missing = Object.keys(FIXTURE).filter((name) => !process.env[name]);
  if (missing.length > 0)
    throw new Error(
      `E2E_BASE_URL is ${BASE_URL}, not the local default ${DEFAULT_BASE_URL}: set ${missing.join(", ")} ` +
        "(the member, another member for conversations and reactions, and the password of both).",
    );
}

const value = (name: keyof typeof FIXTURE) =>
  BASE_URL === DEFAULT_BASE_URL
    ? (process.env[name] ?? FIXTURE[name])
    : (process.env[name] ?? "");

export const USER = value("E2E_USER");
// Another member, for the conversation flow and for content that is not the member's own.
export const PEER = value("E2E_PEER");
// One password for both members.
export const PASSWORD = value("E2E_PASSWORD");
