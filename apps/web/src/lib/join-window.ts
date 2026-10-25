// The one sign-up window a guest gets for an action only members can take (react, vote, take a
// quiz, comment). The action stays a link to the log-in page (`JoinLink`), which a press turns into
// the window once the page holds it: the guests' invitations (`SignupNudges`) say they are there
// for as long as they are. Without them (registration closed, the code not in yet) the link goes
// to the log-in page as before.

export type JoinReason = "react" | "vote" | "quiz" | "comment";

export type JoinAsk = {
  reason: JoinReason;
  // Where logging in comes back to.
  next: string;
};

export type JoinHost = {
  open: (ask: JoinAsk) => void;
  // Fetches the window's code ahead of a press (a pointer over an action, a touch, the focus).
  warm: () => void;
};

let host: JoinHost | null = null;

// The invitations hold the window from now on; the returned function lets it go.
export function hostJoinWindow(next: JoinHost) {
  host = next;
  return () => {
    if (host === next) host = null;
  };
}

// Opens the window, when the page holds it: false when the link is to be followed instead.
export function askToJoin(ask: JoinAsk): boolean {
  if (!host) return false;
  host.open(ask);
  return true;
}

export const warmJoinWindow = () => host?.warm();

// The log-in page, coming back to `next`.
export const loginHref = (next: string) =>
  `/login?next=${encodeURIComponent(next)}`;
