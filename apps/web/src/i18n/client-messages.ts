// The interface text the browser is given: the namespaces (`zone.component`) that client components
// read with `useTranslations`. Everything else is drawn on the server and never sent.
// This is every namespace a client component reads, and the only ones a provider may name. The
// root layout sends `ROOT_NAMESPACES`; a layout adds the rest its pages need with
// `<ClientMessages namespaces={[...]}>`. `tests/client-messages.test.ts` fails when a page, layout or
// error screen has a client component under it whose namespace no provider above it names, when a
// layout names one that nothing under it reads, and when one listed here is read by no client.
export const CLIENT_NAMESPACES = [
  "account.navigation",
  "account.pictures",
  "account.profile",
  "account.security",
  "account.username",
  "admin.confirmPassword",
  "admin.formRows",
  "admin.forumPicker",
  "admin.memberOutcomes",
  "admin.ruleBuilder",
  "admin.shell",
  "adminAppearance.colourRows",
  "adminAppearance.placement",
  "adminContent.reactions",
  "adminContent.tags",
  "adminContent.wordFilters",
  "adminEconomy.awards",
  "adminEconomy.items",
  "adminEconomy.rules",
  "adminForums.pictureField",
  "adminGroups.matrix",
  "adminGroups.promotions",
  "adminSetup.navigation",
  "adminUsers.batch",
  "adminUsers.promotions",
  "auth.forgotPassword",
  "auth.loginForm",
  "auth.notMe",
  "auth.passwordField",
  "auth.passwordStrength",
  "auth.registerForm",
  "auth.resendForm",
  "auth.resetPassword",
  "auth.turnstile",
  "conversations.conversation",
  "conversations.editForm",
  "conversations.newConversationForm",
  "conversations.recipientPicker",
  "credits.buyForm",
  "credits.useForm",
  "credits.wearForm",
  "editor.editor",
  "forum.attachmentField",
  "forum.autosave",
  "forum.bbCode",
  "forum.composer",
  "forum.contentActions",
  "forum.feedFilters",
  "forum.createFlow",
  "forum.feedViewToggle",
  "forum.forumChoicePanel",
  "forum.hideForumButton",
  "forum.framing",
  "forum.infiniteList",
  "forum.memberActions",
  "forum.memberCard",
  "forum.memberCardTrigger",
  "forum.mentionMenu",
  "forum.poll",
  "forum.reactionButton",
  "forum.reactionSummary",
  "forum.shareButton",
  "forum.threadComposer",
  "forum.threadFields",
  "forum.threadTags",
  "forums.forum",
  "home.clampedBody",
  "home.pictureViewer",
  "layout.createButton",
  "layout.guestMenu",
  "layout.headerPanel",
  "layout.headerPanels",
  "layout.lazyPopup",
  "layout.mobileNav",
  "layout.narrowToggle",
  "layout.noticeBanner",
  "layout.routeError",
  "layout.shortcuts",
  "layout.siteNav",
  "layout.themeControl",
  "layout.userMenu",
  "lib.errors",
  "lite.liteMenuDemo",
  "lite.menuItem",
  "lite.navigation",
  "lite.status",
  "members.postComposer",
  "members.wallButtons",
  "moderation.auditedRead",
  "moderation.case",
  "moderation.common",
  "moderation.noticeFields",
  "moderation.review",
  "moderation.signups",
  "skeletons.skeletons",
  "threads.editForm",
  "threads.moderation",
  "threads.replyComposer",
  "ui.bookmark",
  "ui.dialog",
  "ui.iconPicker",
  "ui.sheet",
  "upgrade.rankForm",
] as const;

export type ClientNamespace = (typeof CLIENT_NAMESPACES)[number];

// What every page gets: the error screen the root segment draws.
export const ROOT_NAMESPACES = ["layout.routeError"] as const;

type Catalogue = Record<string, Record<string, unknown> | undefined>;

// The catalogue cut down to the given namespaces, whole.
export function pickClientMessages(
  messages: Catalogue,
  namespaces: readonly ClientNamespace[],
) {
  const picked: Record<string, Record<string, unknown>> = {};
  for (const namespace of namespaces) {
    const [zone, component] = namespace.split(".");
    picked[zone] ??= {};
    picked[zone][component] = messages[zone]?.[component];
  }
  return picked;
}
