"use client";

import { LoaderCircle, LogOut, Settings, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { EntityAvatar } from "@/components/entity-avatar";
import { authClient } from "@/lib/auth-client";

export function AccountMenu() {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const name = session?.user.name ?? "Signed in user";
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    await authClient.signOut();
    toast.success("Signed out");
    router.replace("/sign-in");
    router.refresh();
  }

  return <details className="operator"><summary><EntityAvatar name={name} seed={session?.user.id ?? name} /><span><strong>{name}</strong><small>{session?.user.role === "admin" ? "Administrator" : "SovLend user"}</small></span></summary><div className="operator-menu"><button onClick={() => router.push("/settings/security")} type="button"><UserRound size={15} /> Profile</button><button onClick={() => router.push("/settings/security")} type="button"><Settings size={15} /> Settings</button><button disabled={signingOut} onClick={signOut} type="button">{signingOut ? <LoaderCircle className="spin" size={15} /> : <LogOut size={15} />} Sign out</button></div></details>;
}