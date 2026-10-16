import { ClientMessages } from "@/components/layout/client-messages";

export default function SecurityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClientMessages
      namespaces={[
        "account.security",
        "admin.confirmPassword",
        "admin.formRows",
        "auth.passwordField",
        "auth.passwordStrength",
      ]}
    >
      {children}
    </ClientMessages>
  );
}
