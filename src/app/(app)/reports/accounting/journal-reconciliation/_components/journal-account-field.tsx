"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef } from "react";

import { SearchableSelect, type SearchableSelectOption } from "@/components/searchable-select";

export function JournalAccountField({
  options,
  defaultValue,
}: {
  options: SearchableSelectOption[];
  defaultValue: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fieldRef = useRef<HTMLDivElement>(null);

  function applyAccount(accountId: string) {
    const params = new URLSearchParams();
    const form = fieldRef.current?.closest("form");
    if (form) {
      const data = new FormData(form);
      for (const [key, val] of data.entries()) {
        if (key === "accountId" || typeof val !== "string" || !val) continue;
        params.set(key, val);
      }
    }
    const search = searchParams.get("search");
    if (search) params.set("search", search);
    if (accountId) params.set("accountId", accountId);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div ref={fieldRef}>
      <SearchableSelect
        defaultValue={defaultValue}
        emptyMessage="No accounts match"
        name="accountId"
        onSelect={applyAccount}
        options={options}
        placeholder="Type an account name or code"
      />
    </div>
  );
}
