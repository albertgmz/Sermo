import type { PageKey } from "../../registry";

// The rows of each settings screen that the panel's search finds, in the order the form shows
// them. A row is named as its `Field` is (`data-field` on the page): the search opens the screen
// with `?setting=<name>` and `SettingTarget` brings that row into view. A name with rows under it
// (`levelTitles` for `levelTitles.0`, `levelTitles.1`...) stands for the first of them.
//
// The label and the help are `adminSetup.fields.<name>.label` and `.help` in the messages, unless
// the row names its own (full message keys). `forms.test.tsx` fails when a form draws a row that is
// not listed here, or when a row listed here is not on its screen.
export type SettingRow =
  | string
  | { name: string; label: string; help?: string };

export const SETTING_ROWS = {
  setupGeneral: [
    "siteName",
    "siteDescription",
    "defaultLanguage",
    "profilePostsEnabled",
    "adultMode",
    "socialLinks.discord",
    "socialLinks.telegram",
    "socialLinks.x",
    "analytics.provider",
    "analytics.measurementId",
    "analytics.tagPath",
  ],
  setupHome: [
    {
      name: "homeTab.rules",
      label: "adminSetup.pages.home.formHeading",
      help: "admin.ruleBuilder.help.homeTab",
    },
    {
      name: "homeTab.fallback",
      label: "adminSetup.pages.home.fallbackLabel",
      help: "adminSetup.pages.home.fallbackHelp",
    },
    {
      name: "feedExcludedForumIds",
      label: "adminSetup.pages.home.excludedLabel",
      help: "adminSetup.pages.home.excludedHelp",
    },
  ],
  setupMembers: [
    "registrationOpen",
    "approveSignups",
    "requireEmailConfirmation",
    "minimumAge",
    "registrationFields",
    {
      name: "welcomeMessage.enabled",
      label: "adminSetup.pages.members.welcome.enabledLabel",
      help: "adminSetup.pages.members.welcome.note",
    },
    {
      name: "welcomeMessage.sender",
      label: "adminSetup.pages.members.welcome.senderLabel",
      help: "adminSetup.pages.members.welcome.senderHelp",
    },
    {
      name: "welcomeMessage.subject",
      label: "adminSetup.pages.members.welcome.subjectLabel",
      help: "adminSetup.pages.members.welcome.subjectHelp",
    },
    {
      name: "welcomeMessage.body",
      label: "adminSetup.pages.members.welcome.bodyLabel",
      help: "adminSetup.pages.members.welcome.bodyHelp",
    },
    "newMemberDays",
    "firstPostsToModerate",
    "moderateLinksFromNewMembers",
    "newMemberMentionLimit",
  ],
  setupAntispam: [
    "floodSeconds",
    {
      name: "linksRule",
      label: "admin.ruleBuilder.label.postLinks",
      help: "admin.ruleBuilder.help.postLinks",
    },
    {
      name: "approvalRule",
      label: "admin.ruleBuilder.label.postApproval",
      help: "admin.ruleBuilder.help.postApproval",
    },
    "signatureMaxLength",
    "signatureMaxLines",
    "signatureMaxLinks",
    "signatureMaxImages",
    "signatureMaxSmilies",
    "signatureMaxTextSize",
    "signatureFormats",
    {
      name: "signatureRule",
      label: "admin.ruleBuilder.label.signature",
      help: "admin.ruleBuilder.help.signature",
    },
    "turnstileEnabled",
    "turnstileSiteKey",
    "turnstileSecret",
    "turnstileForms",
  ],
  setupUploads: [
    "maxUploadBytes",
    {
      name: "allowedUploadTypes",
      label: "adminSetup.pages.uploads.typesHeading",
      help: "adminSetup.pages.uploads.typesDescription",
    },
    {
      name: "groupUploadLimitBytes",
      label: "adminSetup.pages.uploads.groupsHeading",
      help: "adminSetup.pages.uploads.groupsDescription",
    },
  ],
  setupSeo: [
    "threadTitleTemplate",
    "nodeTitleTemplate",
    "profileTitleTemplate",
    "indexNowKey",
  ],
  setupIdentity: [
    {
      name: "logoFileId",
      label: "adminSetup.identity.logoFileId.label",
      help: "adminSetup.identity.logoFileId.help",
    },
    {
      name: "iconFileId",
      label: "adminSetup.identity.iconFileId.label",
      help: "adminSetup.identity.iconFileId.help",
    },
    {
      name: "backdropFileId",
      label: "adminSetup.identity.backdropFileId.label",
      help: "adminSetup.identity.backdropFileId.help",
    },
  ],
  setupLevels: [
    "levelStep",
    "levelTitles",
    "customTitleMaxLength",
    "standingPostPoints",
    "standingReactionsPerPoint",
    "standingReferralPoints",
    "standingExcludeStaff",
    "standingExcludedUserIds",
    {
      name: "standingExcludeRule",
      label: "admin.ruleBuilder.label.standing",
      help: "admin.ruleBuilder.help.standing",
    },
  ],
  setupCookies: ["cookieBannerOutsideEu"],
} as const satisfies Partial<Record<PageKey, readonly SettingRow[]>>;

export type SettingsScreenKey = keyof typeof SETTING_ROWS;

// The message keys of a row's label and help.
export function rowText(row: SettingRow) {
  if (typeof row === "string")
    return {
      name: row,
      label: `adminSetup.fields.${row}.label`,
      help: `adminSetup.fields.${row}.help`,
    };
  return row;
}
