import { useTranslations } from "next-intl";
import { AuthShellSkeleton } from "@/app/[locale]/(auth)/auth-shell";
import { ForgotSkeleton } from "@/app/[locale]/(auth)/forgot-password/forgot-skeleton";

export default function Loading() {
  const t = useTranslations("auth.loading");
  return (
    <AuthShellSkeleton heading={t("forgotHeading")}>
      <ForgotSkeleton />
    </AuthShellSkeleton>
  );
}
