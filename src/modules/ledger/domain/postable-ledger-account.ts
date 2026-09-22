export const postableLedgerAccountWhere = {
  active: true,
  usage: "DETAIL",
} as const;

export function isPostableLedgerAccount(account: { active: boolean; usage: string }) {
  return account.active && account.usage === "DETAIL";
}
