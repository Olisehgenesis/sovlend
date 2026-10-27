"use client";

import { useEffect } from "react";

export function ScrollToPosted({ journalId }: { journalId: string | null }) {
  useEffect(() => {
    if (!journalId) return;
    document.getElementById(`journal-${journalId}`)?.scrollIntoView({ block: "center" });
  }, [journalId]);

  return null;
}
