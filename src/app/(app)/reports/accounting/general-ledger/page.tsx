import GeneralLedgerView from "./_components/general-ledger-view";

export default function GeneralLedgerPage(props: {
  searchParams: Promise<{ startDate?: string; endDate?: string; officeId?: string; preset?: string; accountId?: string }>;
}) {
  return <GeneralLedgerView {...props} />;
}
