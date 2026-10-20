import { ClientMessages } from "@/components/layout/client-messages";

export default function ApiLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClientMessages
      namespaces={[
        "account.apiKeys",
        "admin.confirmPassword",
        "admin.formRows",
        "auth.passwordField",
        "forum.copyButton",
      ]}
    >
      {children}
    </ClientMessages>
  );
}
