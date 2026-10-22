import { pushList, pushPublicKey } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { PushDevices } from "@/app/[locale]/(main)/account/notifications/push-devices";
import { Section } from "@/components/staff/rows";
import { read } from "@/lib/sermo/client";
import { getViewer } from "@/lib/sermo/session";

// The devices that receive the member's push notifications: this one, which they turn on and off
// here, and the others the account lists, which they can remove.
export async function PushDevicesSection() {
  const [t, key, list, { user }] = await Promise.all([
    getTranslations("account.pushDevices"),
    read(pushPublicKey, {}),
    read(pushList, {}),
    getViewer(),
  ]);
  if (!user) return null;
  return (
    <Section id="devices" heading={t("heading")} description={t("description")}>
      <PushDevices
        member={String(user.id)}
        session={user.sessionId === null ? null : String(user.sessionId)}
        publicKey={key.publicKey}
        devices={list.items}
      />
    </Section>
  );
}
