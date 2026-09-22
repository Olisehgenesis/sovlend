"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { getRolePlaybook, rolePlaybooks, type RolePlaybookId } from "@/modules/docs/role-playbooks";

export function RoleDocs({ initialRole }: { initialRole: RolePlaybookId }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("role") ?? initialRole;
  const playbook = getRolePlaybook(selectedId);

  function selectRole(role: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("role", role);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="docs-layout">
      <label className="docs-role-picker">
        Role playbook
        <select onChange={(event) => selectRole(event.target.value)} value={playbook.id}>
          {rolePlaybooks.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>

      <section className="panel docs-summary">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{playbook.label}</p>
            <h2>What this role does</h2>
            <p>{playbook.summary}</p>
          </div>
        </div>
      </section>

      {playbook.howTos.map((howTo) => (
        <article className="panel docs-howto" key={howTo.title}>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">How to</p>
              <h2>{howTo.title}</h2>
              {howTo.intro ? <p>{howTo.intro}</p> : null}
            </div>
          </div>
          <ol className="docs-steps">
            {howTo.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {howTo.note ? <aside className="configuration-note"><strong>Watch this</strong><span>{howTo.note}</span></aside> : null}
        </article>
      ))}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{playbook.label}</p>
            <h2>Actions</h2>
            <p>Screens this role uses day to day.</p>
          </div>
        </div>
        <div className="docs-actions">
          {playbook.actions.map((action) =>
            action.href ? (
              <Link className="docs-action" href={action.href} key={action.title}>
                <strong>{action.title}</strong>
                <span>{action.description}</span>
              </Link>
            ) : (
              <div className="docs-action" key={action.title}>
                <strong>{action.title}</strong>
                <span>{action.description}</span>
              </div>
            ),
          )}
        </div>
      </section>
    </div>
  );
}
