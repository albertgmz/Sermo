import { NotificationLink } from "@/app/[locale]/(main)/notifications/notification-link";

// The client components the header's panels hold that no other server module of a page imports.
// `loadAlerts` (panel-actions.tsx) is a server action that returns the rows as UI. React can only
// serialise a reference to a client component that the route's client reference manifest lists,
// and Next lists there only the client modules that a server module of that route imports (what a
// server action imports does not count). Without this list a production build fails when the
// alerts panel opens on any page that does not draw a notification itself, with "Could not find the
// module ... in the React Client Manifest" (error #441). `account-menu.tsx`, which every page with
// the header panels renders, imports this module. The call to `Object.freeze` keeps the import from
// being dropped. The messages panel and the bookmarks tab hold only client components that the
// pages list already.
export const PANEL_CLIENT_PARTS = Object.freeze([NotificationLink]);
