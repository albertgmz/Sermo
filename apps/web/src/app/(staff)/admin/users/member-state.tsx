import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";

const VARIANTS = {
  valid: "success",
  unconfirmed: "secondary",
  banned: "destructive",
  erased: "outline",
} as const;

// The account state of a member as a tag.
export function MemberState({ state }: { state: keyof typeof VARIANTS }) {
  const t = useTranslations("adminUsers.states");
  return <Badge variant={VARIANTS[state]}>{t(state)}</Badge>;
}
