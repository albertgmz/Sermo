import { ClientMessages } from "@/components/layout/client-messages";

export default function ForumLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClientMessages namespaces={["forums.forum", "threads.moderation"]}>
      {children}
    </ClientMessages>
  );
}
