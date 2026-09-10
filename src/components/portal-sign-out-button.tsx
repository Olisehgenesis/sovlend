"use client";

import { LoaderCircle, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

export function PortalSignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    await authClient.signOut();
    toast.success("Signed out");
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <button className="secondary-action" disabled={pending} onClick={signOut} type="button">
      {pending ? <LoaderCircle className="spin" size={15} /> : <LogOut size={15} />} Sign out
    </button>
  );
}
