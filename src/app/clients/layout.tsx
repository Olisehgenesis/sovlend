import { OperationsNav } from "@/components/operations-nav";

export default function ClientsLayout({ children }: { children: React.ReactNode }) {
  return <div className="workspace-screen"><OperationsNav active="clients" />{children}</div>;
}