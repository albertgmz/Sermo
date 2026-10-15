import { findRecipients } from "@/app/[locale]/(main)/conversations/actions";
import {
  confirmSample,
  discardForm,
  saveSample,
} from "@/app/[locale]/(main)/ui/actions";
import { StaffNavigation } from "@/app/[locale]/(staff)/navigation";
import type { NavSection } from "@/app/[locale]/(staff)/navigation-data";
import { UserLink } from "@/components/forum/user-link";
import { ConfirmPassword } from "@/components/staff/confirm-password";
import { ConfirmStep } from "@/components/staff/confirm-step";
import type { Criterion } from "@/components/staff/criteria-rule";
import { CursorList } from "@/components/staff/cursor-list";
import { findThreads } from "@/components/staff/find-threads";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { ForumPicker } from "@/components/staff/forum-picker";
import { LogTable } from "@/components/staff/log-table";
import { MemberOutcomeList } from "@/components/staff/member-outcomes";
import { Notice } from "@/components/staff/notice";
import {
  type MatrixPermission,
  PermissionMatrix,
} from "@/components/staff/permission-matrix";
import { PictureField } from "@/components/staff/picture-field";
import { RuleBuilder } from "@/components/staff/rule-builder";
import { ThreadBatch, ThreadTick } from "@/components/staff/thread-batch";
import { Input } from "@/components/ui/input";
import { plainMember } from "@/lib/sermo/members";

const criterion = (
  id: string,
  title: string,
  kind: Criterion["kind"],
  unit: Criterion["unit"],
  more: Partial<Criterion> = {},
): Criterion => ({
  id,
  title,
  help: "",
  kind,
  unit,
  cost: "cheap",
  idKind: null,
  window: false,
  modes: [],
  measured: false,
  ...more,
});

const CRITERIA: Criterion[] = [
  criterion("post_count", "Posts", "atLeast", "count", {
    help: "How many posts the member has written.",
  }),
  criterion("has_avatar", "Has a picture", "boolean", "boolean"),
  criterion("warning_points_below", "Warning points", "below", "points", {
    help: "Unexpired points, summed in the background.",
    cost: "background",
  }),
  criterion("in_group", "In one of these groups", "groups", "groups", {
    idKind: "groups",
  }),
  criterion("is_member", "Is one of these members", "members", "members", {
    idKind: "members",
  }),
  criterion("posts_in_threads", "Posts in threads", "atLeast", "count", {
    help: "Posts in the chosen threads, in each, in any one or all added together.",
    cost: "background",
    idKind: "threads",
    modes: ["each", "one", "all"],
  }),
  criterion("credits_earned", "Credits earned", "atLeast", "count", {
    help: "Earned from credit rules and awards, in total or within the last days.",
    cost: "background",
    window: true,
  }),
  criterion("holds_awards", "Holds awards", "ids", "ids", {
    idKind: "awards",
    modes: ["one", "none", "each"],
  }),
];

const MATRIX: MatrixPermission[] = [
  {
    id: "forum.react",
    type: "flag",
    scope: "node",
    title: "Forum react",
    category: "forum",
    categoryTitle: "Forums",
    unit: null,
    initial: "Allow",
  },
  {
    id: "forum.edit",
    type: "flag",
    scope: "node",
    title: "Forum edit",
    category: "forum",
    categoryTitle: "Forums",
    unit: null,
  },
  {
    id: "general.maxLinks",
    type: "integer",
    scope: "global",
    title: "General max links",
    category: "general",
    categoryTitle: "General",
    unit: "count",
  },
];

const NAV: NavSection[] = [
  {
    id: "home",
    label: "Home",
    screens: [{ href: "/admin", label: "Home" }],
  },
  {
    id: "forums",
    label: "Forums",
    screens: [
      { href: "/admin/forums", label: "Categories and forums" },
      { href: "/admin/forums/prefixes", label: "Thread prefixes" },
    ],
  },
  {
    id: "groups",
    label: "Groups and permissions",
    screens: [
      {
        href: "/admin/groups",
        label: "User groups",
        group: { id: "groups", label: "Groups" },
      },
      {
        href: "/admin/promotions",
        label: "Group promotions",
        group: { id: "groups", label: "Groups" },
      },
      {
        href: "/admin/permissions/groups",
        label: "Group permissions",
        group: { id: "permissions", label: "Permissions" },
      },
      {
        href: "/admin/staff/moderators",
        label: "Moderators",
        group: { id: "staff", label: "Staff" },
      },
    ],
  },
  {
    id: "tools",
    label: "Tools and logs",
    screens: [
      { href: "/admin/logs/moderator", label: "Moderator log" },
      { href: "/admin/logs/credits", label: "Credit ledger" },
    ],
  },
];

const nova = plainMember({ id: 1, username: "nova" });
const kestrel = plainMember({ id: 2, username: "kestrel" });

const CREDIT_RULES = [
  { id: 4, name: "Reply in a forum", amount: 2, limit: "20 a day" },
  { id: 3, name: "Thread started", amount: 5, limit: "10 a day" },
  { id: 2, name: "Reaction received", amount: 1, limit: "No limit" },
];

const LOG = [
  {
    id: 31,
    at: "2026-10-12T09:14:00.000Z",
    actor: <UserLink user={nova} />,
    action: "settings.update",
    target: "Site settings",
    details: { keys: ["siteName", "notificationRetentionDays"] },
    reason: "",
  },
  {
    id: 30,
    at: "2026-10-12T08:02:00.000Z",
    actor: <UserLink user={kestrel} />,
    action: "post.delete",
    target: "Post 1204 in thread 88",
    details: { nodeId: 3, notify: true },
    reason: "Spam links.",
  },
  {
    id: 29,
    at: "2026-10-11T22:40:00.000Z",
    actor: null,
    action: "credits.recalculate",
    target: "All members",
    details: null,
    reason: "",
  },
];

// The shared pieces of the administration panel with sample data, and the panel's navigation. Their props are documented at the top of each file in components/staff.
export function StaffDemos() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Navigation</h3>
        <p className="max-w-prose text-sm text-muted-foreground">
          The panel&apos;s side navigation (a drawer below the desktop layout)
          takes the sections the viewer may open. The section of the current
          screen is always open.
        </p>
        <div className="max-w-xs rounded-lg border bg-card p-2">
          <StaffNavigation sections={NAV} label="Administration" />
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Thread batch</h3>
        <p className="max-w-prose text-sm text-muted-foreground">
          The tick beside each thread of a forum&apos;s list, and the bar that
          appears once some are ticked: one change for all of them, a reason,
          and a line saying how many changed and why the others were refused.
          Applying here changes nothing.
        </p>
        <ThreadBatch
          action={discardForm}
          actions={["lock", "unlock", "stick", "unstick", "move", "setPrefix"]}
          forums={[
            { id: 1, label: "General" },
            { id: 2, label: "Help" },
          ]}
          prefixes={[{ id: 1, label: "News" }]}
        >
          <ul className="divide-y overflow-hidden rounded-lg border bg-card">
            {["A thread", "Another thread", "A third thread"].map(
              (title, index) => (
                <li key={title} className="flex items-center gap-3 px-4 py-3">
                  <ThreadTick id={index + 1} title={title} />
                  <span className="text-sm">{title}</span>
                </li>
              ),
            )}
          </ul>
        </ThreadBatch>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Cursor list</h3>
        <p className="max-w-prose text-sm text-muted-foreground">
          A page of a list with the cursor in the address. &quot;Next&quot; is a
          link to the same page with the cursor of the following one; on this
          page it opens the styleguide again.
        </p>
        <CursorList
          items={CREDIT_RULES}
          nextCursor="eyJpZCI6Mn0"
          path="/ui"
          params={{}}
          itemKey={(rule) => rule.id}
          label="Credit rules"
          render={(rule) => (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
              <p className="min-w-0 text-sm font-medium">{rule.name}</p>
              <p className="text-xs text-muted-foreground">
                +{rule.amount} credits · {rule.limit}
              </p>
            </div>
          )}
        />
        <CursorList
          items={[]}
          nextCursor={null}
          path="/ui"
          params={{}}
          itemKey={(rule: { id: number }) => rule.id}
          render={() => null}
          empty={{
            title: "No credit rules",
            description: "Rules you add appear here.",
          }}
        />
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Form rows</h3>
        <p className="max-w-prose text-sm text-muted-foreground">
          Label, control and help rows, an error line per field, a form-level
          notice and a save bar that sticks to the bottom and shows a pending
          state. Leave the title empty to see the errors.
        </p>
        <FormRows
          action={saveSample}
          heading="Credit rule"
          description="When a member earns credits and how many."
        >
          <FieldRow
            name="title"
            label="Title"
            htmlFor="sample-title"
            help="Shown to members in their ledger."
          >
            <Input
              id="sample-title"
              name="title"
              defaultValue="Reply in a forum"
            />
          </FieldRow>
          <FieldRow
            name="amount"
            label="Credits"
            htmlFor="sample-amount"
            help="Negative takes credits away."
          >
            <Input
              id="sample-amount"
              name="amount"
              type="number"
              defaultValue={2}
            />
          </FieldRow>
          <ConfirmPassword id="sample-password" />
        </FormRows>
        <p className="max-w-prose text-sm text-muted-foreground">
          With <code>disabled</code> the same form is read-only: every control
          and the save button are off.
        </p>
        <FormRows
          action={saveSample}
          heading="Credit rule (read-only)"
          disabled
        >
          <FieldRow name="title" label="Title" htmlFor="sample-title-off">
            <Input
              id="sample-title-off"
              name="title"
              defaultValue="Reply in a forum"
            />
          </FieldRow>
        </FormRows>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Picture field</h3>
        <p className="max-w-prose text-sm text-muted-foreground">
          A picture control for a form. The chosen file goes at once to the
          panel&apos;s upload route (never through the form), with its progress
          and the backend&apos;s refusal, and the id it was stored under travels
          in a hidden field for the form&apos;s action. The current picture is a
          slot the caller draws on the server; removable adds a Remove control.
        </p>
        <div className="max-w-md overflow-hidden rounded-lg border bg-card p-4">
          <PictureField
            purpose="node_icon"
            id="sample-picture"
            removable
            current={
              <span className="flex size-16 items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">
                Current
              </span>
            }
          />
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Rule builder</h3>
        <p className="max-w-prose text-sm text-muted-foreground">
          The one editor of a rule (who something applies to), for promotions,
          awards, notices and the shop. The place decides which criteria are
          offered (the shop and notices only take the cheap ones, so the
          background one is missing from the second) and what an empty rule
          says. The rule travels in one JSON field named <code>rule</code>.
        </p>
        <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
          {(["award", "notice"] as const).map((place) => (
            <div key={place} className="rounded-lg border bg-card p-4">
              <h4 className="mb-3 text-xs font-semibold text-muted-foreground">
                {place}
              </h4>
              <RuleBuilder
                place={place}
                criteria={CRITERIA}
                rule={{
                  match: "any",
                  conditions: [
                    { criterion: "post_count", value: 100 },
                    { criterion: "has_avatar", value: 1 },
                  ],
                }}
                limits={{
                  conditions: 20,
                  value: 1_000_000_000,
                  ids: 500,
                  days: 3650,
                }}
                findMembers={findRecipients}
                findThreads={findThreads}
                choices={{
                  groups: [
                    { id: 3, label: "Moderators" },
                    { id: 4, label: "Veterans" },
                  ],
                  items: [],
                  members: [],
                  threads: [],
                  awards: [{ id: 1, label: "Veteran" }],
                  shopCategories: [],
                  creditRules: [],
                  reactionTypes: [{ id: 1, label: "Like" }],
                }}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Forum picker</h3>
        <p className="max-w-prose text-sm text-muted-foreground">
          Chooses forums by name for an administration form (the list is held in
          the page). The ids travel in one field named <code>forumIds</code>,
          comma-separated, empty when none is chosen.
        </p>
        <div className="max-w-md rounded-lg border bg-card p-4">
          <ForumPicker
            choices={[
              { id: 1, label: "Support" },
              { id: 2, label: "— Bug reports" },
              { id: 3, label: "Lounge" },
            ]}
            chosen={[1]}
          />
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Permission matrix</h3>
        <p className="max-w-prose text-sm text-muted-foreground">
          The permissions of one target as a form body, grouped by category,
          with a filter box; allowNo adds the forum-only &quot;No&quot; state.
          Inside FormRows it is read back with matrixChanges. Every row also
          posts a hidden <code>was:&lt;permission&gt;</code> field with the
          value it showed, so only the rows that differ from it count as
          changed.
        </p>
        <div className="overflow-hidden rounded-lg border bg-card">
          <PermissionMatrix
            permissions={MATRIX}
            entries={{ "forum.react": "allow", "general.maxLinks": 3 }}
            allowNo
          />
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Confirm step</h3>
        <p className="max-w-prose text-sm text-muted-foreground">
          The confirmation of a destructive or irreversible action, in the page
          as a closed block: opening it shows what will happen, its inputs and
          the button that does it, and the backend&apos;s answer comes back
          under the button. With <code>password</code> it asks for the
          administrator&apos;s own password and shows a refusal on that field;
          with <code>heading</code> it becomes the panel of a record&apos;s
          page. Type <code>wrong</code> as the password to see the refusal.
        </p>
        <div className="space-y-4">
          <ConfirmStep
            action={confirmSample}
            summary="Remove the cover"
            warning="The cover is taken off for good."
            submit="Remove it"
            reason="Reason (optional)"
          />
          <div className="max-w-md">
            <ConfirmStep
              action={confirmSample}
              heading="Delete this group"
              submit="Delete the group"
              warning="Its members move to the default group."
              password
            />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Notice</h3>
        <p className="max-w-prose text-sm text-muted-foreground">
          The confirmation a save redirects with (<code>?notice=saved</code>),
          shown above the first panel of the page. A name the page does not list
          shows nothing.
        </p>
        <Notice
          searchParams={Promise.resolve({ notice: "saved" })}
          notices={{ saved: "Saved. The change is live." }}
        />
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Member outcome list</h3>
        <p className="max-w-prose text-sm text-muted-foreground">
          What a batch of member actions did to each member (the sign-up
          decisions and the batch update of members): the name, whether it was
          done, skipped or failed, and the backend&apos;s reason for the last
          two.
        </p>
        <MemberOutcomeList
          items={[
            { name: "wren", status: "done", message: null },
            {
              name: "robin",
              status: "skipped",
              message: "Already in that primary group.",
            },
            {
              name: "ghost",
              status: "failed",
              message: "No member goes by that name.",
            },
          ]}
        />
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Log table</h3>
        <p className="max-w-prose text-sm text-muted-foreground">
          Filters are a GET form and show only what the caller passes; rows are
          columns on a desktop and stacked cards on a phone, with the details
          expanding in place. A parameter chosen elsewhere on the page (a member
          picked with a picker) is kept through Apply with carry.
        </p>
        <LogTable
          entries={LOG}
          nextCursor="eyJpZCI6Mjl9"
          path="/ui"
          params={{}}
          label="Moderator log"
          filters={{
            search: { name: "action", label: "Action" },
            selects: [
              {
                name: "actorId",
                label: "Actor",
                options: [
                  { value: "1", label: "nova" },
                  { value: "2", label: "kestrel" },
                ],
              },
            ],
            dates: { from: "from", to: "to" },
            carry: { member: "1" },
          }}
        />
      </div>
    </div>
  );
}
