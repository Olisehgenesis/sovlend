import { OperationsNav } from "@/components/operations-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <div className="workspace-screen"><OperationsNav active="security" />{children}</div>;
}