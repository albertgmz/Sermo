import { useTranslations } from "next-intl";
import { SPEC_PATH } from "./prepare-spec";

const code = (chunks: React.ReactNode) => (
  <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.85em] break-words">
    {chunks}
  </code>
);

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-6 text-xl font-semibold tracking-tight">{children}</h2>
  );
}

// What a visitor needs to know before using the reference: how to sign in, what a key may not
// do, and how the API refuses.
export function DeveloperIntro() {
  const t = useTranslations("developer.intro");
  return (
    <div className="mb-6 max-w-prose">
      <p>{t("lead")}</p>
      <p className="mt-2">
        <a
          href={SPEC_PATH}
          className="font-medium text-primary-ink underline underline-offset-4 hover:no-underline"
        >
          {t("specLink")}
        </a>
      </p>
      <Heading>{t("authHeading")}</Heading>
      <p className="mt-2">{t("authSession")}</p>
      <p className="mt-2 rounded-lg border border-primary/40 p-3 font-medium">
        {t("realRequests")}
      </p>
      <p className="mt-2">{t.rich("authKey", { code })}</p>
      <p className="mt-2">{t.rich("createKey", { code })}</p>
      <Heading>{t("keysHeading")}</Heading>
      <p className="mt-2">{t("keysAccess")}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>{t("keysManage")}</li>
        <li>{t("keysPassword")}</li>
      </ul>
      <p className="mt-2">{t("keysEnd")}</p>
      <Heading>{t("limitsHeading")}</Heading>
      <p className="mt-2">{t("limitsRate")}</p>
      <p className="mt-2">{t("limitsStaff")}</p>
    </div>
  );
}
