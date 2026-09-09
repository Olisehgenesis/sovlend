"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";
import { forwardRef, useImperativeHandle, useRef } from "react";

/**
 * Shared wrapper around the native `<dialog>` element, consolidating the modal chrome
 * (heading + close button) that used to be hand-copied into 5 different components
 * (disburse-loan-button, record-payment-button, loan-service-actions-panel,
 * new-savings-account-wizard, and the now-deleted reverse-disbursement-button).
 *
 * Kept imperative (ref.showModal()/ref.close()) rather than a controlled `open` prop so
 * existing call sites — trigger buttons calling showModal() directly, forms calling
 * close() on success — didn't need restructuring, only the repeated markup was removed.
 */
export type DialogHandle = {
  showModal: () => void;
  close: () => void;
};

export const Dialog = forwardRef<
  DialogHandle,
  {
    title: string;
    onClose?: () => void;
    children: ReactNode;
    className?: string;
  }
>(function Dialog({ title, onClose, children, className }, ref) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      showModal: () => dialogRef.current?.showModal(),
      close: () => dialogRef.current?.close(),
    }),
    [],
  );

  return (
    <dialog className={`app-modal${className ? ` ${className}` : ""}`} onClose={onClose} ref={dialogRef}>
      <div className="app-modal-heading">
        <h2>{title}</h2>
        <button aria-label="Close" className="icon-action" onClick={() => dialogRef.current?.close()} type="button">
          <X size={16} />
        </button>
      </div>
      {children}
    </dialog>
  );
});
