import { staffModerators } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { MemberRow } from "@/components/forum/member-row";
import { Section } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { read } from "@/lib/sermo/client";
import { MemberPicker } from "../../permissions/member-picker";
import { setModerator } from "../actions";
import { InlineForm } from "../inline-form";

// The administrator's own password, which the change is sent with.
function PasswordInput({ label }: { label: string }) {
  return (
    <Input
      type="password"
      name="actorPassword"
      autoComplete="off"
      required
      aria-label={label}
      placeholder={label}
      className="w-full sm:w-48"
    />
  );
}

// Who moderates this forum (from `staff.moderators`: members with a moderation permission on it,
// or everywhere), a remove control per member, and a member picker to add one. Both write
// `nodes.setModerator`, which needs `admin.permissions`: the page shows this panel only to a
// viewer who holds it.
export async function Moderators({
  nodeId,
  query,
}: {
  nodeId: number;
  query: string | undefined;
}) {
  const [t, { items, truncated }] = await Promise.all([
    getTranslations("adminForums.moderators"),
    read(staffModerators, {}),
  ]);
  const here = items.filter(
    (item) => item.everywhere || item.nodes.some((node) => node.id === nodeId),
  );
  return (
    <>
      <Section
        id="moderators"
        heading={t("heading")}
        description={t("description")}
      >
        {here.length > 0 ? (
          <ul aria-label={t("heading")} className="divide-y">
            {here.map((item) => {
              const onNode = item.nodes.some((node) => node.id === nodeId);
              return (
                <li key={item.card.id}>
                  <MemberRow user={item.card} className="flex-wrap py-3">
                    {item.everywhere && (
                      <Badge variant="success">{t("everywhere")}</Badge>
                    )}
                    {onNode && (
                      <InlineForm
                        action={setModerator}
                        submit={t("remove")}
                        variant="destructive"
                      >
                        <input type="hidden" name="id" value={nodeId} />
                        <input
                          type="hidden"
                          name="userId"
                          value={item.card.id}
                        />
                        <input type="hidden" name="remove" value="1" />
                        <PasswordInput label={t("password")} />
                      </InlineForm>
                    )}
                  </MemberRow>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("none")}</p>
        )}
        {truncated && (
          <p className="border-t p-4 text-xs text-muted-foreground">
            {t("truncated")}
          </p>
        )}
      </Section>
      <MemberPicker
        query={query}
        keep={{}}
        heading={t("addHeading")}
        action={t("profile")}
        href={(id) => `/members/${id}`}
        id="moderator-search"
      >
        {(member) => (
          <InlineForm action={setModerator} submit={t("add")} variant="default">
            <input type="hidden" name="id" value={nodeId} />
            <input type="hidden" name="userId" value={member.id} />
            <PasswordInput label={t("password")} />
          </InlineForm>
        )}
      </MemberPicker>
    </>
  );
}
