"use client";

import { useRouter } from "next/navigation";

export function StatusSelect({
  label,
  value,
  options,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string; href: string }[];
}) {
  const router = useRouter();

  return (
    <label className="status-select">
      <span>{label}</span>
      <select
        onChange={(event) => {
          const next = options.find((option) => option.value === event.target.value);
          if (next) router.push(next.href);
        }}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value || "all"} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
