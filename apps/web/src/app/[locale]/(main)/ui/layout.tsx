import { ClientMessages } from "@/components/layout/client-messages";

export default function StyleguideLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClientMessages
      namespaces={[
        "account.navigation",
        "account.profile",
        "adminForums.pictureField",
        "adminGroups.matrix",
        "admin.forumPicker",
        "admin.ruleBuilder",
        "forum.autosave",
        "forum.framing",
        "forum.memberActions",
        "forums.forum",
        "lite.liteMenuDemo",
        "lite.navigation",
        "ui.iconPicker",
        "admin.confirmPassword",
        "admin.formRows",
        "auth.passwordField",
      ]}
    >
      {children}
    </ClientMessages>
  );
}
