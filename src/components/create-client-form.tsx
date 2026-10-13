"use client";

import { LoaderCircle, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { BrandActionButton } from "@/components/ui/brand-action-button";

export function CreateClientForm({ offices, groups }: { offices: Array<{ id: string; name: string }>; groups: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [membershipType, setMembershipType] = useState("INDIVIDUAL");
  const defaultOfficeId = offices.find((office) => office.name.trim().toLowerCase() === "head office")?.id ?? offices[0]?.id ?? "";

  async function createClient(formData: FormData) {
    setPending(true);
    const response = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        officeId: formData.get("officeId"),
        firstName: formData.get("firstName"),
        middleName: formData.get("middleName") || undefined,
        lastName: formData.get("lastName"),
        mobileNumber: formData.get("mobileNumber") || undefined,
        dateOfBirth: formData.get("dateOfBirth") || undefined,
        genderCode: formData.get("genderCode") || undefined,
        clientTypeCode: formData.get("clientTypeCode") || undefined,
        classificationCode: formData.get("classificationCode") || undefined,
        externalId: formData.get("externalId") || undefined,
        active: formData.get("active") === "on",
        isStaff: formData.get("isStaff") === "on",
        membershipType: formData.get("membershipType") || "INDIVIDUAL",
        chargeCrb: formData.get("chargeCrb") === "on",
        groupId: formData.get("groupId") || undefined,
      }),
    });
    const result = await response.json();
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Client could not be created");
      return;
    }
    toast.success(`Client ${result.accountNumber} created`);
    router.push(`/clients/${result.accountNumber}`);
    router.refresh();
  }

  return <form action={createClient} className="entity-form"><fieldset><legend>Office and identity</legend><label>Office<select defaultValue={defaultOfficeId} name="officeId" required>{offices.map((office) => <option key={office.id} value={office.id}>{office.name}</option>)}</select></label><div className="form-row three"><label>First name<input name="firstName" required /></label><label>Middle name<input name="middleName" /></label><label>Last name<input name="lastName" required /></label></div><div className="form-row"><label>Mobile number<input name="mobileNumber" inputMode="tel" /></label><label>Date of birth<input name="dateOfBirth" type="date" /></label></div></fieldset><fieldset><legend>Classification</legend><div className="form-row three"><label>Gender<select name="genderCode" defaultValue=""><option value="">Not specified</option><option>Female</option><option>Male</option><option>Other</option></select></label><label>Client type<input name="clientTypeCode" /></label><label>Classification<input name="classificationCode" /></label></div><label>External ID<input name="externalId" /></label><div className="check-row"><label><input name="active" type="checkbox" /> Activate immediately</label><label><input name="isStaff" type="checkbox" /> Client is also staff</label></div></fieldset><fieldset><legend>Opening charges</legend><label>Membership<select value={membershipType} onChange={(event) => setMembershipType(event.target.value)} name="membershipType"><option value="INDIVIDUAL">Individual · admission 25,000</option><option value="GROUP">Group · admission 7,000</option></select></label>{membershipType === "GROUP" ? <label>Group<select name="groupId" required>{groups.length === 0 ? <option value="">No active groups in your scope</option> : groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label> : null}<div className="check-row"><label><input name="chargeCrb" type="checkbox" /> Charge CRB (15,000: 5,000 income + 10,000 fee)</label></div><p className="field-help">New members open a member-contribution account (MSA) instead of savings; individuals are charged 25,000 admission here, group members 7,000. Group members also open security, LIF, and savings accounts and are added to the selected group.</p></fieldset><div className="form-actions"><BrandActionButton disabled={pending} icon={pending ? <LoaderCircle className="spin" size={18} /> : <UserPlus size={18} />} type="submit">Create client</BrandActionButton></div></form>;
}