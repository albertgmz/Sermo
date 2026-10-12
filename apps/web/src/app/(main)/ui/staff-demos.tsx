import { saveSample } from "@/app/(main)/ui/actions";
import { StaffNavigation } from "@/app/(staff)/navigation";
import type { NavSection } from "@/app/(staff)/navigation-data";
import { UserLink } from "@/components/forum/user-link";
import { ConfirmPassword } from "@/components/staff/confirm-password";
import { CursorList } from "@/components/staff/cursor-list";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { LogTable } from "@/components/staff/log-table";
import {
  type MatrixPermission,
  PermissionMatrix,
} from "@/components/staff/permission-matrix";
import { Input } from "@/components/ui/input";
import { plainMember } from "@/lib/sermo/members";

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

// The three shared pieces of the administration panel with sample data, and the panel's
// navigation. Their props are documented at the top of each file in components/staff.
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
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Permission matrix</h3>
        <p className="max-w-prose text-sm text-muted-foreground">
          The permissions of one target as a form body, grouped by category,
          with a filter box; allowNo adds the forum-only &quot;No&quot; state.
          Inside FormRows it is read back with matrixChanges.
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
        <h3 className="text-sm font-semibold">Log table</h3>
        <p className="max-w-prose text-sm text-muted-foreground">
          Filters are a GET form and show only what the caller passes; rows are
          columns on a desktop and stacked cards on a phone, with the details
          expanding in place.
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
          }}
        />
      </div>
    </div>
  );
}
