"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

export function PortalSignOutButton() {
  const router = useRouter();

  async function signOut() {
    await authClient.signOut();
    toast.success("Signed out");
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <button className="secondary-action" onClick={signOut} type="button">
      <LogOut size={15} /> Sign out
    </button>
  );
}
