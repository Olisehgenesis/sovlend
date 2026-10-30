"use client";

import type { ButtonHTMLAttributes } from "react";

/** Forest is the only primary. Gold paints rust and is reserved for delete, reject, and undo. */
export function BrandActionButton({
  variant = "primary",
  icon,
  children,
  className,
  ...rest
}: {
  variant?: "primary" | "gold";
  icon?: React.ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const variantClass = variant === "primary" ? "" : ` brand-action-button--${variant}`;
  return (
    <button {...rest} className={`brand-action-button${variantClass}${className ? ` ${className}` : ""}`} type={rest.type ?? "button"}>
      {icon}
      {children}
    </button>
  );
}
