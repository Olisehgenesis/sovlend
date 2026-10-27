"use client";

import type { ButtonHTMLAttributes } from "react";

/** Plain forest action button. Gold is the destructive confirm. */
export function BrandActionButton({
  variant = "primary",
  icon,
  children,
  className,
  ...rest
}: {
  variant?: "primary" | "gold" | "blue" | "purple";
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
