import Link from "next/link";

/** Full-cell overlay so a table row stays clickable even with sticky columns and horizontal scroll. */
export function TableRowLink({
  href,
  label,
  primary = false,
}: {
  href: string;
  label: string;
  primary?: boolean;
}) {
  return (
    <Link
      aria-hidden={primary ? undefined : true}
      aria-label={primary ? label : undefined}
      className="row-link"
      href={href}
      tabIndex={primary ? undefined : -1}
    />
  );
}
