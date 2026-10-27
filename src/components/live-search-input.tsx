"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

// Live search: debounced as-you-type, and clearing the box goes back to the full list automatically.
export function LiveSearchInput({ placeholder, paramName = "query" }: { placeholder: string; paramName?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const paramValue = searchParams.get(paramName) ?? "";
  const [value, setValue] = useState(paramValue);
  const [syncedParam, setSyncedParam] = useState(paramValue);
  if (paramValue !== syncedParam) {
    setSyncedParam(paramValue);
    setValue(paramValue);
  }

  useEffect(() => {
    if (value === paramValue) return;
    const timeout = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(paramName, value);
      else params.delete(paramName);
      params.delete("page");
      const queryString = params.toString();
      router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
    }, 300);
    return () => clearTimeout(timeout);
  }, [value, paramValue, paramName, pathname, router, searchParams]);

  return (
    <div className="directory-search">
      <Search size={17} />
      <input onChange={(event) => setValue(event.target.value)} placeholder={placeholder} value={value} />
      {value ? <button aria-label="Clear search" className="search-clear" onClick={() => setValue("")} type="button"><X size={15} /></button> : null}
    </div>
  );
}
