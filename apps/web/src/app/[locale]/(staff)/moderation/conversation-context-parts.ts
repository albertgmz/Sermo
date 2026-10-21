import { MentionCards } from "@/components/forum/mention-cards";
import { SpoilerReveal } from "@/components/forum/spoiler-reveal";

// The client components that `ConversationContext` holds through `HtmlContent`, which an audited
// read (`AuditedRead`) gets from a server action: `viewReportedMessage`, `viewApprovalMessage`.
// React can only serialise a reference to a client component that the route's client reference
// manifest lists, and Next lists there only the client modules that a server module of that route
// imports (what a server action imports does not count, nor does a client module such as
// `AuditedRead`). The reported message page imports nothing that reaches these two, so in a
// production build the moderator's "confirm view" answered with "Could not find the module ... in
// the React Client Manifest" (React error #441). Every page that offers an audited read imports
// this module (`tests/staff-manifest.test.ts` finds those pages and checks their lists). The call
// to `Object.freeze` keeps the imports from being dropped.
export const CONTEXT_CLIENT_PARTS = Object.freeze([
  MentionCards,
  SpoilerReveal,
]);
