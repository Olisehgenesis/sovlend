export function isLoanApplicationExpired(applicationExpiresOn: Date | null | undefined, now = new Date()) {
  if (!applicationExpiresOn) return false;
  const expiryDay = Date.UTC(
    applicationExpiresOn.getUTCFullYear(),
    applicationExpiresOn.getUTCMonth(),
    applicationExpiresOn.getUTCDate(),
  );
  const currentDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return expiryDay < currentDay;
}
