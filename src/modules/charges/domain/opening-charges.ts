export const ADMISSION_INDIVIDUAL_CHARGE_NAME = "Admission fee (individual)";
export const ADMISSION_GROUP_CHARGE_NAME = "Admission fee (group)";
export const MEMBER_CRB_INCOME_CHARGE_NAME = "CRB income (member)";
export const MEMBER_CRB_FEE_CHARGE_NAME = "CRB fee (member)";

export type MembershipKind = "INDIVIDUAL" | "GROUP";

export function openingChargeNames(input: { membership: MembershipKind; chargeCrb: boolean }) {
  const names = [input.membership === "GROUP" ? ADMISSION_GROUP_CHARGE_NAME : ADMISSION_INDIVIDUAL_CHARGE_NAME];
  if (input.chargeCrb) {
    names.push(MEMBER_CRB_INCOME_CHARGE_NAME, MEMBER_CRB_FEE_CHARGE_NAME);
  }
  return names;
}

export function isAdmissionChargeName(name: string) {
  const normalized = name.trim().toLowerCase();
  return normalized === ADMISSION_INDIVIDUAL_CHARGE_NAME.toLowerCase() || normalized === ADMISSION_GROUP_CHARGE_NAME.toLowerCase();
}
