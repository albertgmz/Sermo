import {
  nodesList,
  permissionsList,
  permissionsListNode,
  usersCards,
} from "@sermo/core/contracts";
import { SearchCheck } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Field, FieldGroup } from "@/components/staff/edit-form";
import { ItemList, RowLink } from "@/components/staff/item-list";
import { Notice } from "@/components/staff/notice";
import { selectClass } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { getGroups, groupLabel } from "../../groups/data";
import { entriesOf, getDefinitions, matrixPermissions } from "../data";
import { MemberPicker } from "../member-picker";
import { PermissionForm } from "../permission-form";
import { SubmitRow } from "../submit-row";

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) || undefined;

type Params = Record<string, string | string[] | undefined>;

// The permissions set on one forum, per group and per member, and the form to change them: the
// forum is picked from the tree, then an entry set is edited or a group or member is added.
// The address holds the choices: `node`, then `group` or `user` for the target being edited, and
// `q` for the member search. The forum screens of the Forums section link here with `node`.
export async function ForumPermissions({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const [t, { items: nodes }] = await Promise.all([
    getTranslations("adminGroups.permissionForums"),
    read(nodesList, {}),
  ]);
  const nodeRaw = first(params.node);
  const nodeId = nodeRaw === undefined ? null : parseId(nodeRaw);
  if (nodeRaw !== undefined && nodeId === null) notFound();
  const node = nodeId === null ? null : nodes.find((n) => n.id === nodeId);
  if (nodeId !== null && !node) notFound();

  const picker = (
    <form className="min-w-0">
      <FieldGroup legend={t("pickHeading")}>
        <Field name="node" label={t("forum")} htmlFor="forum-node">
          <select
            id="forum-node"
            name="node"
            required
            defaultValue={nodeId ?? ""}
            className={selectClass}
          >
            <option value="" disabled>
              {t("choose")}
            </option>
            {nodes.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {"— ".repeat(entry.depth)}
                {entry.title}
              </option>
            ))}
          </select>
        </Field>
        <SubmitRow label={t("show")} />
      </FieldGroup>
    </form>
  );
  if (!node || nodeId === null) return picker;

  const groupRaw = first(params.group);
  const userRaw = first(params.user);
  const groupId = groupRaw === undefined ? null : parseId(groupRaw);
  const userId = userRaw === undefined ? null : parseId(userRaw);
  if (
    (groupRaw !== undefined && groupId === null) ||
    (userRaw !== undefined && userId === null) ||
    (groupId !== null && userId !== null)
  ) {
    notFound();
  }
  const [viewerGroups, definitions, listing] = await Promise.all([
    getGroups(),
    getDefinitions(),
    read(permissionsListNode, { nodeId }),
  ]);
  const memberIds = [
    ...new Set(
      [...listing.items.map((set) => set.userId), userId].filter(
        (id): id is number => id !== null,
      ),
    ),
  ];
  const cards = memberIds.length
    ? (await read(usersCards, { userIds: memberIds })).items
    : [];
  const nameOf = (id: number) =>
    cards.find((card) => card.id === id)?.username ?? `#${id}`;
  const titles = new Map(
    definitions.map((definition) => [definition.id, definition.title]),
  );
  const valueText = (value: string | number) =>
    value === "allow"
      ? t("allow")
      : value === "never"
        ? t("never")
        : value === "no"
          ? t("no")
          : value === -1
            ? t("unlimited")
            : String(value);
  const here = `?node=${nodeId}`;

  let editor: React.ReactNode = null;
  if (groupId !== null || userId !== null) {
    const group =
      groupId === null ? null : viewerGroups?.find((g) => g.id === groupId);
    const set = await read(
      permissionsList,
      groupId !== null
        ? { groupId, nodeId }
        : { userId: userId as number, nodeId },
    );
    editor = (
      <PermissionForm
        target={
          groupId !== null ? { group: groupId } : { user: userId as number }
        }
        node={nodeId}
        heading={t("editHeading", {
          target:
            groupId !== null
              ? (group?.title ?? t("groupNumber", { id: groupId }))
              : nameOf(userId as number),
          forum: node.title,
        })}
        permissions={await matrixPermissions(definitions, { nodeOnly: true })}
        entries={entriesOf(set)}
      />
    );
  }

  return (
    <>
      <Notice
        namespace="adminGroups.notices"
        searchParams={searchParams}
        shown={["saved"]}
      />
      {picker}
      <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">
        {node.title}
      </h2>
      {editor}
      <ItemList
        label={t("setHeading")}
        heading={t("setHeading")}
        description={t("setDescription")}
        empty={{ title: t("none") }}
        items={listing.items.map((set) => {
          const isGroup = set.groupId !== null;
          const id = (isGroup ? set.groupId : set.userId) as number;
          const name = isGroup
            ? groupLabel(viewerGroups, id, (n) => t("groupNumber", { id: n }))
            : nameOf(id);
          const edit = `${here}&${isGroup ? "group" : "user"}=${id}`;
          return {
            id: `${isGroup ? "g" : "u"}${id}`,
            title: name,
            href: edit,
            badges: (
              <Badge variant="secondary">
                {isGroup ? t("group") : t("member")}
              </Badge>
            ),
            actions: (
              <>
                <RowLink href={edit} label={t("editLabel", { target: name })} />
                {!isGroup && (
                  <RowLink
                    href={`/admin/permissions/explain?user=${id}&node=${nodeId}`}
                    label={t("analyseLabel", { target: name })}
                    icon={<SearchCheck />}
                  />
                )}
              </>
            ),
            panel: (
              <ul
                aria-label={t("entriesOf", { target: name })}
                className="flex flex-wrap gap-1.5 pb-1"
              >
                {set.entries.map((entry) => (
                  <li
                    key={entry.permission}
                    className="rounded-sm border px-1.5 py-0.5 text-xs [overflow-wrap:anywhere]"
                  >
                    {titles.get(entry.permission) ?? entry.permission}:{" "}
                    <span className="font-medium">
                      {valueText(entry.value)}
                    </span>
                  </li>
                ))}
              </ul>
            ),
          };
        })}
      />
      <form className="min-w-0">
        <input type="hidden" name="node" value={nodeId} />
        <FieldGroup legend={t("addGroup")}>
          <Field name="group" label={t("group")} htmlFor="add-group">
            {viewerGroups ? (
              <select
                id="add-group"
                name="group"
                required
                defaultValue=""
                className={selectClass}
              >
                <option value="" disabled>
                  {t("choose")}
                </option>
                {viewerGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.title}
                  </option>
                ))}
              </select>
            ) : (
              <Input id="add-group" name="group" inputMode="numeric" required />
            )}
          </Field>
          <SubmitRow label={t("add")} />
        </FieldGroup>
      </form>
      <MemberPicker
        query={first(params.q)}
        keep={{ node: String(nodeId) }}
        heading={t("addMember")}
        action={t("add")}
        href={(id) => `${here}&user=${id}`}
        id="add-member"
      />
    </>
  );
}
