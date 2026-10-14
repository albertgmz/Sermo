import {
  nodesList,
  permissionsExplain,
  usersCards,
} from "@sermo/core/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { selectClass } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { call, errorMessage, read } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { parseId } from "@/lib/sermo/ids";
import { getDefinitions } from "../data";
import { MemberPicker } from "../member-picker";

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) || undefined;

// Why a member has or lacks a permission: the question (member, permission, optionally a forum)
// is in the address, the answer is `permissions.explain`'s result and every layer that went into
// it, in the order the backend returns them.
export async function Explain({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const [t, definitions, { items: nodes }] = await Promise.all([
    getTranslations("adminGroups.explain"),
    getDefinitions(),
    read(nodesList, {}),
  ]);
  const userRaw = first(params.user);
  const userId = userRaw === undefined ? null : parseId(userRaw);
  const nodeRaw = first(params.node);
  const nodeId = nodeRaw === undefined ? null : parseId(nodeRaw);
  if (
    (userRaw !== undefined && userId === null) ||
    (nodeRaw !== undefined && nodeId === null)
  ) {
    notFound();
  }
  const permission = first(params.permission);
  const chosen = definitions.find((definition) => definition.id === permission);
  const member =
    userId === null
      ? undefined
      : (await read(usersCards, { userIds: [userId] })).items[0];
  if (userId !== null && !member) notFound();

  const keep: Record<string, string> = {};
  if (chosen) keep.permission = chosen.id;
  if (nodeId !== null) keep.node = String(nodeId);
  const search = (user: number) =>
    `?${new URLSearchParams({ ...keep, user: String(user) })}`;

  // A permission of forum scope is answered for a forum only; the backend would refuse the
  // question in its own words, so the form says it first.
  const needsForum = chosen?.scope === "node" && nodeId === null;

  let answer: React.ReactNode = null;
  if (member && chosen && needsForum) {
    answer = (
      <p
        role="alert"
        className="rounded-lg border bg-card p-4 text-sm text-destructive"
      >
        {t("forumRequired")}
      </p>
    );
  } else if (member && chosen) {
    try {
      const result = await call(permissionsExplain, {
        userId: member.id,
        permission: chosen.id,
        ...(nodeId !== null ? { nodeId } : {}),
      });
      const nodeTitle = (id: number | null) =>
        id === null
          ? t("unset")
          : id === 0
            ? t("everywhere")
            : (nodes.find((node) => node.id === id)?.title ??
              t("forumNumber", { id }));
      answer = (
        <section className="overflow-hidden rounded-lg border bg-card">
          <div className="space-y-2 border-b p-4">
            <h2 className="text-sm font-semibold">{t("resultHeading")}</h2>
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={result.granted ? "success" : "destructive"}>
                {result.granted ? t("granted") : t("denied")}
              </Badge>
              {result.value !== null && (
                <span>
                  {t("value")}{" "}
                  <span className="font-medium">
                    {result.value === -1 ? t("unlimited") : result.value}
                  </span>
                </span>
              )}
              <span className="text-muted-foreground">
                {result.nodeId === null
                  ? t("global")
                  : t("onForum", { forum: nodeTitle(result.nodeId) })}
              </span>
            </p>
            {result.deniedBy && (
              <p className="text-sm text-destructive">
                {t("deniedBy", { rule: t(`rules.${result.deniedBy}`) })}
              </p>
            )}
          </div>
          <div className="p-4 pb-0">
            <h3 className="text-sm font-semibold">{t("layersHeading")}</h3>
            <p className="text-xs text-muted-foreground">{t("layersHelp")}</p>
          </div>
          {result.layers.length > 0 ? (
            <ol aria-label={t("layersHeading")} className="divide-y">
              {result.layers.map((layer, index) => (
                <li
                  key={`${layer.kind}:${layer.groupId}:${layer.userId}:${layer.title}`}
                  className="grid gap-1 p-4 sm:grid-cols-[2rem_8rem_minmax(0,1fr)_8rem_minmax(0,12rem)] sm:items-center sm:gap-3"
                >
                  <span className="text-xs text-muted-foreground">
                    {index + 1}
                  </span>
                  <span>
                    <Badge variant="secondary">
                      {t(`kinds.${layer.kind}`)}
                    </Badge>
                  </span>
                  <span className="text-sm font-medium [overflow-wrap:anywhere]">
                    {layer.kind === "member"
                      ? member.username
                      : (layer.title ?? t("unnamed"))}
                  </span>
                  <span className="text-sm">
                    {layer.value === "allow"
                      ? t("allow")
                      : layer.value === "never"
                        ? t("never")
                        : layer.value === "no"
                          ? t("no")
                          : layer.value === "unset"
                            ? t("unset")
                            : layer.value === -1
                              ? t("unlimited")
                              : layer.value}
                  </span>
                  <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {layer.value === "unset"
                      ? ""
                      : t("setOn", { where: nodeTitle(layer.sourceNodeId) })}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("noLayers")}</p>
          )}
        </section>
      );
    } catch (error) {
      if (!(error instanceof SermoError)) throw error;
      answer = (
        <p
          role="alert"
          className="rounded-lg border bg-card p-4 text-sm text-destructive [overflow-wrap:anywhere]"
        >
          {await errorMessage(error)}
        </p>
      );
    }
  }

  return (
    <>
      <section className="overflow-hidden rounded-lg border bg-card">
        <form className="space-y-3 p-4">
          <h2 className="text-sm font-semibold">{t("questionHeading")}</h2>
          {member && <input type="hidden" name="user" value={member.id} />}
          <p className="text-sm">
            {t("member")}{" "}
            <span className="font-medium">
              {member ? member.username : t("noMember")}
            </span>
            {member && (
              <Link
                href={`/admin/permissions/members/${member.id}`}
                className="ml-3 inline-flex min-h-10 items-center text-primary-ink underline-offset-4 hover:underline"
              >
                {t("memberPermissions")}
              </Link>
            )}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1">
              <label
                htmlFor="explain-permission"
                className="text-sm font-medium"
              >
                {t("permission")}
              </label>
              <select
                id="explain-permission"
                name="permission"
                required
                defaultValue={chosen?.id ?? ""}
                className={selectClass}
              >
                <option value="" disabled>
                  {t("choosePermission")}
                </option>
                {[...new Set(definitions.map((entry) => entry.category))].map(
                  (category) => (
                    <optgroup
                      key={category}
                      label={
                        definitions.find((entry) => entry.category === category)
                          ?.categoryTitle
                      }
                    >
                      {definitions
                        .filter((entry) => entry.category === category)
                        .map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.title} ({entry.id})
                          </option>
                        ))}
                    </optgroup>
                  ),
                )}
              </select>
            </div>
            <div className="min-w-0 space-y-1">
              <label htmlFor="explain-node" className="text-sm font-medium">
                {t("forum")}
              </label>
              <select
                id="explain-node"
                name="node"
                defaultValue={nodeId ?? ""}
                className={selectClass}
              >
                <option value="">{t("noForum")}</option>
                {nodes.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {"— ".repeat(entry.depth)}
                    {entry.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Button type="submit" disabled={!member} className="min-h-10 px-4">
            {t("explain")}
          </Button>
          {!member && (
            <p className="text-xs text-muted-foreground">{t("pickFirst")}</p>
          )}
        </form>
      </section>
      {answer}
      <MemberPicker
        query={first(params.q)}
        keep={keep}
        heading={member ? t("changeMember") : t("pickMember")}
        action={t("choose")}
        href={(id) => search(id)}
        id="explain-member"
      />
    </>
  );
}
