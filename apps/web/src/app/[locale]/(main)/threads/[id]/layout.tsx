import { ClientMessages } from "@/components/layout/client-messages";

export default function ThreadLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClientMessages
      namespaces={["threads.moderation", "threads.replyComposer"]}
    >
      {children}
    </ClientMessages>
  );
}
