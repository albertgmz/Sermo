import type { PageKey } from "../../registry";

// The rows of each settings screen that the panel's search finds, in the order the form shows
// them, by the card (`FieldGroup`) they sit in: `legend` is the message key of the card's legend,
// shown at the end of the result's path. A row is named as its `Field` is (`data-field` on the
// page): the search opens the screen with `?setting=<name>` and `SettingTarget` brings that row into
// view. A name with rows under it (`levelTitles` for `levelTitles.0`, `levelTitles.1`...) stands
// for the first of them.
//
// The label and the help are `adminSetup.fields.<name>.label` and `.help` in the messages, unless
// the row names its own (full message keys). A write-only secret is left out: there is nothing in
// it to find, and its key stays in the files that write it. `forms.test.tsx` fails when a form
// draws another row that is not listed here, or when a row listed here is not on its screen.
export type SettingRow =
  | string
  | { name: string; label: string; help?: string };

export type SettingGroup = { legend: string; rows: readonly SettingRow[] };

const page = (name: string) => `adminSetup.pages.${name}`;

export const SETTING_ROWS = {
  setupGeneral: [
    {
      legend: `${page("general")}.formHeading`,
      rows: [
        "siteName",
        "siteDescription",
        "defaultLanguage",
        "profilePostsEnabled",
        "adultMode",
      ],
    },
    {
      legend: `${page("general")}.linksHeading`,
      rows: ["socialLinks.discord", "socialLinks.telegram", "socialLinks.x"],
    },
    {
      legend: `${page("general")}.analyticsHeading`,
      rows: [
        "analytics.provider",
        "analytics.measurementId",
        "analytics.tagPath",
      ],
    },
  ],
  setupHome: [
    {
      legend: `${page("home")}.formHeading`,
      rows: [
        {
          name: "homeTab.rules",
          label: "admin.ruleBuilder.label.homeTab",
          help: "admin.ruleBuilder.help.homeTab",
        },
        {
          name: "homeTab.fallback",
          label: `${page("home")}.fallbackLabel`,
          help: `${page("home")}.fallbackHelp`,
        },
        {
          name: "feedExcludedForumIds",
          label: `${page("home")}.excludedLabel`,
          help: `${page("home")}.excludedHelp`,
        },
      ],
    },
  ],
  setupMembers: [
    {
      legend: `${page("members")}.registration`,
      rows: [
        "registrationOpen",
        "approveSignups",
        "requireEmailConfirmation",
        "minimumAge",
        "registrationFields",
      ],
    },
    {
      legend: `${page("members")}.welcome.heading`,
      rows: [
        {
          name: "welcomeMessage.enabled",
          label: `${page("members")}.welcome.enabledSwitch`,
          help: `${page("members")}.welcome.note`,
        },
        {
          name: "welcomeMessage.sender",
          label: `${page("members")}.welcome.senderLabel`,
          help: `${page("members")}.welcome.senderHelp`,
        },
        {
          name: "welcomeMessage.subject",
          label: `${page("members")}.welcome.subjectLabel`,
          help: `${page("members")}.welcome.subjectHelp`,
        },
        {
          name: "welcomeMessage.body",
          label: `${page("members")}.welcome.bodyLabel`,
          help: `${page("members")}.welcome.bodyHelp`,
        },
      ],
    },
    {
      legend: `${page("members")}.formHeading`,
      rows: [
        "newMemberDays",
        "firstPostsToModerate",
        "moderateLinksFromNewMembers",
        "newMemberMentionLimit",
      ],
    },
  ],
  setupAntispam: [
    {
      legend: `${page("antispam")}.posting`,
      rows: [
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
      ],
    },
    {
      legend: `${page("antispam")}.signatures`,
      rows: [
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
      ],
    },
    {
      legend: `${page("antispam")}.turnstile`,
      rows: ["turnstileEnabled", "turnstileSiteKey", "turnstileForms"],
    },
  ],
  setupUploads: [
    { legend: `${page("uploads")}.sizeHeading`, rows: ["maxUploadBytes"] },
    {
      legend: `${page("uploads")}.typesHeading`,
      rows: [
        {
          name: "allowedUploadTypes",
          label: `${page("uploads")}.typesHeading`,
          help: `${page("uploads")}.typesDescription`,
        },
      ],
    },
    {
      legend: `${page("uploads")}.groupsHeading`,
      rows: [
        {
          name: "groupUploadLimitBytes",
          label: `${page("uploads")}.groupsHeading`,
          help: `${page("uploads")}.groupsDescription`,
        },
      ],
    },
  ],
  setupSeo: [
    {
      legend: `${page("seo")}.formHeading`,
      rows: [
        "threadTitleTemplate",
        "nodeTitleTemplate",
        "profileTitleTemplate",
        "indexNowKey",
      ],
    },
  ],
  setupIdentity: [
    {
      legend: "adminSetup.identity.formHeading",
      rows: ["logoFileId", "iconFileId", "backdropFileId"].map((name) => ({
        name,
        label: `adminSetup.identity.${name}.label`,
        help: `adminSetup.identity.${name}.help`,
      })),
    },
  ],
  setupLevels: [
    {
      legend: `${page("levels")}.curve`,
      rows: ["levelStep", "levelTitles"],
    },
    {
      legend: `${page("levels")}.limits`,
      rows: ["customTitleMaxLength"],
    },
    {
      legend: `${page("levels")}.standing`,
      rows: [
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
    },
  ],
  setupCookies: [
    {
      legend: `${page("cookies")}.formHeading`,
      rows: ["cookieBannerOutsideEu"],
    },
  ],
} as const satisfies Partial<Record<PageKey, readonly SettingGroup[]>>;

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
