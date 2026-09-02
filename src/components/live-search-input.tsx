"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

// Live search: debounced as-you-type, and clearing the box goes back to the full list automatically.
export function LiveSearchInput({ placeholder }: { placeholder: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get("query") ?? "");

  useEffect(() => {
    const current = searchParams.get("query") ?? "";
    if (value === current) return;
    const timeout = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set("query", value);
      else params.delete("query");
      params.delete("page");
      const queryString = params.toString();
      router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
    }, 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="directory-search">
      <Search size={17} />
      <input onChange={(event) => setValue(event.target.value)} placeholder={placeholder} value={value} />
      {value ? <button aria-label="Clear search" className="search-clear" onClick={() => setValue("")} type="button"><X size={15} /></button> : null}
    </div>
  );
}
