import { useTranslations } from "next-intl";
import { AuthShellSkeleton } from "@/app/(auth)/auth-shell";
import { ForgotSkeleton } from "@/app/(auth)/forgot-password/forgot-skeleton";

export default function Loading() {
  const t = useTranslations("auth.loading");
  return (
    <AuthShellSkeleton heading={t("forgotHeading")}>
      <ForgotSkeleton />
    </AuthShellSkeleton>
  );
}
