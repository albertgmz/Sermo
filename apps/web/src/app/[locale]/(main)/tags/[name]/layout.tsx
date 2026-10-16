import { ClientMessages } from "@/components/layout/client-messages";

export default function TagLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClientMessages namespaces={["forums.forum"]}>{children}</ClientMessages>
  );
}
