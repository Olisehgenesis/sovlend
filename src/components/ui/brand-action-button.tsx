"use client";

import type { ButtonHTMLAttributes } from "react";

/**
 * Animated "folder + pencil" action button, themed onto SovLend's forest-green palette (see
 * `.brand-action-button` in globals.css). Use for the app's primary/high-visibility action
 * buttons -- pass `variant` to pick an on-brand accent when several sit side by side.
 */
export function BrandActionButton({
  variant = "primary",
  icon,
  children,
  className,
  ...rest
}: {
  variant?: "primary" | "gold" | "blue";
  icon?: React.ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const variantClass = variant === "primary" ? "" : ` brand-action-button--${variant}`;
  return (
    <button {...rest} className={`brand-action-button${variantClass}${className ? ` ${className}` : ""}`} type={rest.type ?? "button"}>
      <div>
        <div className="folder">
          <div className="top">
            <svg viewBox="0 0 24 27">
              <path d="M1,0 L23,0 C23.5522847,-1.01453063e-16 24,0.44771525 24,1 L24,8.17157288 C24,8.70200585 23.7892863,9.21071368 23.4142136,9.58578644 L20.5857864,12.4142136 C20.2107137,12.7892863 20,13.2979941 20,13.8284271 L20,26 C20,26.5522847 19.5522847,27 19,27 L1,27 C0.44771525,27 6.76353751e-17,26.5522847 0,26 L0,1 C-6.76353751e-17,0.44771525 0.44771525,1.01453063e-16 1,0 Z" />
            </svg>
          </div>
          <div className="paper" />
        </div>
        <div className="pencil" />
      </div>
      {icon}
      {children}
    </button>
  );
}
