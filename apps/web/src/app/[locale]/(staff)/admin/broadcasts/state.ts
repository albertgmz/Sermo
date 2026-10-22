// What the form of a message or alert to members (a client component) and its server action share.
// No runtime import of the contracts: the form reaches the browser.

export type BroadcastKind = "message" | "alert";

// What a test send came to: who got it, whether it was delivered, and the conversation of a message.
export type TestResult = {
  name: string;
  delivered: boolean;
  reason: string | null;
  conversationId: number | null;
};

export type BroadcastState = {
  error?: string;
  fields?: Record<string, string>;
  notice?: string;
  test?: TestResult;
} | null;

export const STEPS = ["test", "count"] as const;
export type Step = (typeof STEPS)[number];
export const isStep = (value: string): value is Step =>
  (STEPS as readonly string[]).includes(value);

// The longest alert text (the contract's own limit, repeated here for the form).
export const ALERT_TEXT_MAX = 300;
