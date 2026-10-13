import GeneralLedgerView from "../../_components/general-ledger-view";

export default async function LedgerAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ startDate?: string; endDate?: string; officeId?: string; preset?: string }>;
}) {
  return <GeneralLedgerView selectedAccountId={(await params).accountId} searchParams={searchParams} />;
}
