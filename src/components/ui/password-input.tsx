"use client";

import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import { useState } from "react";
import type { ComponentPropsWithoutRef } from "react";

type PasswordInputProps = ComponentPropsWithoutRef<"input">;

/** Password field with a show/hide toggle so users can confirm what they typed before submitting. */
export function PasswordInput({ className, ...inputProps }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={className ?? "auth-input"}>
      <LockKeyhole size={17} />
      <input {...inputProps} type={visible ? "text" : "password"} />
      <button
        aria-label={visible ? "Hide password" : "Show password"}
        className="auth-input-toggle"
        onClick={() => setVisible((current) => !current)}
        type="button"
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
