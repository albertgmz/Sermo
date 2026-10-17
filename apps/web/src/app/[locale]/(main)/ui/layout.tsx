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
        "admin.confirmPassword",
        "admin.formRows",
        "admin.forumPicker",
        "admin.ruleBuilder",
        "admin.shell",
        "adminForums.pictureField",
        "adminGroups.matrix",
        "auth.passwordField",
        "forum.autosave",
        "forum.framing",
        "forum.memberActions",
        "forums.forum",
        "lite.liteMenuDemo",
        "lite.navigation",
        "ui.iconPicker",
      ]}
    >
      {children}
    </ClientMessages>
  );
}
