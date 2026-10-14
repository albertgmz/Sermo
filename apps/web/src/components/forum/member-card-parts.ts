import { MemberCardScope } from "@/components/forum/member-card-scope";
import { MemberCardTrigger } from "@/components/forum/member-card-trigger";
import { MemberFollowButton } from "@/components/forum/member-follow-button";
import { Avatar } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { Tooltip } from "@/components/ui/tooltip";

// The client components the server-rendered member card holds. `loadMemberCard` is a server
// action that returns the card as UI. React can only serialise a reference to a client component
// that the route's client reference manifest lists, and Next lists there only the client modules
// that a server module of that route imports (a client module importing them does not count).
// A page with a name that opens a card but no postbit (the home feed, a forum, the members list,
// conversations, the panel) would otherwise fail with "Could not find the module ... in the React
// Client Manifest" (error #441). The root layout imports this module, so every route lists them.
//
// Every client module (`"use client"`) reachable from `Postbit`, `MemberActions` and
// `MemberCardMinimal` must be listed; `member-card-parts.test.ts` scans their imports and fails
// when one is missing. The call to `Object.freeze` keeps the imports from being dropped.
export const CARD_CLIENT_PARTS = Object.freeze([
  Avatar,
  MemberCardScope,
  MemberCardTrigger,
  MemberFollowButton,
  Progress,
  Tooltip,
]);
