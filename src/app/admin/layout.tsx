import { OperationsNav } from "@/components/operations-nav";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="workspace-screen"><OperationsNav active="admin" admin />{children}</div>;
}