import { useTranslations } from "next-intl";
import { AuthShellSkeleton } from "@/app/(auth)/auth-shell";
import { ResetSkeleton } from "@/app/(auth)/reset-password/reset-skeleton";

export default function Loading() {
  const t = useTranslations("auth.loading");
  return (
    <AuthShellSkeleton heading={t("resetHeading")}>
      <ResetSkeleton />
    </AuthShellSkeleton>
  );
}
