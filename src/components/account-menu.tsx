"use client";

import { LogOut, Settings, UserRound } from "lucide-react";
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

  return <details className="operator"><summary><span className="avatar">{initials}</span><span><strong>{name}</strong><small>{session?.user.role === "admin" ? "Administrator" : "SovLend user"}</small></span></summary><div className="operator-menu"><button onClick={() => router.push("/settings/security")} type="button"><UserRound size={15} /> Profile</button><button onClick={() => router.push("/settings/security")} type="button"><Settings size={15} /> Settings</button><button onClick={signOut} type="button"><LogOut size={15} /> Sign out</button></div></details>;
}