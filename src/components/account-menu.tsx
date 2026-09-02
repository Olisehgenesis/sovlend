"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

export function AccountMenu() {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const name = session?.user.name ?? "Signed in user";
  const initials = name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();

  async function signOut() {
    await authClient.signOut();
    toast.success("Signed out");
    router.replace("/sign-in");
    router.refresh();
  }

  return <div className="operator"><span className="avatar">{initials}</span><span><strong>{name}</strong><small>{session?.user.role === "admin" ? "Administrator" : "SovLend user"}</small></span><button aria-label="Sign out" onClick={signOut} title="Sign out"><LogOut size={16} /></button></div>;
}