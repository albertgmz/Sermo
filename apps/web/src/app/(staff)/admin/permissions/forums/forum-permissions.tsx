import {
  nodesList,
  permissionsList,
  permissionsListNode,
  usersCards,
} from "@sermo/core/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { selectClass } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { cn } from "@/lib/utils";
import { getGroups, groupLabel } from "../../groups/data";
import { Notice } from "../../groups/notice";
import { permissionTitle } from "../../groups/phrases";
import { entriesOf, getDefinitions, matrixPermissions } from "../data";
import { MemberPicker } from "../member-picker";
import { PermissionForm } from "../permission-form";

const link = cn(buttonVariants({ variant: "outline" }), "min-h-10 px-4");

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
    <section className="overflow-hidden rounded-lg border bg-card">
      <form className="space-y-3 p-4">
        <h2 className="text-sm font-semibold">{t("pickHeading")}</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1 sm:max-w-md">
            <label htmlFor="forum-node" className="text-sm font-medium">
              {t("forum")}
            </label>
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
          </div>
          <Button type="submit" className="min-h-10 px-4">
            {t("show")}
          </Button>
        </div>
      </form>
    </section>
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
    definitions.map((definition) => [
      definition.id,
      permissionTitle(definition.label),
    ]),
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
      <Notice searchParams={searchParams} shown={["saved"]} />
      {picker}
      <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">
        {node.title}
      </h2>
      {editor}
      <section className="overflow-hidden rounded-lg border bg-card">
        <div className="border-b p-4">
          <h2 className="text-sm font-semibold">{t("setHeading")}</h2>
          <p className="text-xs text-muted-foreground">{t("setDescription")}</p>
        </div>
        {listing.items.length > 0 ? (
          <ul aria-label={t("setHeading")} className="divide-y">
            {listing.items.map((set) => {
              const isGroup = set.groupId !== null;
              const id = (isGroup ? set.groupId : set.userId) as number;
              return (
                <li
                  key={`${isGroup ? "g" : "u"}${id}`}
                  className="flex flex-col gap-3 p-4 md:flex-row md:items-start"
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      <span className="[overflow-wrap:anywhere]">
                        {isGroup
                          ? groupLabel(viewerGroups, id, (n) =>
                              t("groupNumber", { id: n }),
                            )
                          : nameOf(id)}
                      </span>
                      <Badge variant="secondary">
                        {isGroup ? t("group") : t("member")}
                      </Badge>
                    </p>
                    <ul className="flex flex-wrap gap-1.5">
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
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`${here}&${isGroup ? "group" : "user"}=${id}`}
                      className={link}
                    >
                      {t("edit")}
                    </Link>
                    {!isGroup && (
                      <Link
                        href={`/admin/permissions/explain?user=${id}&node=${nodeId}`}
                        className={link}
                      >
                        {t("analyse")}
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("none")}</p>
        )}
      </section>
      <section className="overflow-hidden rounded-lg border bg-card">
        <form className="space-y-3 p-4">
          <h2 className="text-sm font-semibold">{t("addGroup")}</h2>
          <input type="hidden" name="node" value={nodeId} />
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1 sm:max-w-xs">
              <label htmlFor="add-group" className="text-sm font-medium">
                {t("group")}
              </label>
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
                <Input
                  id="add-group"
                  name="group"
                  inputMode="numeric"
                  required
                />
              )}
            </div>
            <Button type="submit" className="min-h-10 px-4">
              {t("add")}
            </Button>
          </div>
        </form>
      </section>
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
