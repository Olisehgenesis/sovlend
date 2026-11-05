const JUMPSTART_HOSTS = new Set(["jumpstartafrica.org", "www.jumpstartafrica.org"]);

export function donationReturnUrl(value: string | undefined): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (!JUMPSTART_HOSTS.has(host) && !host.endsWith(".jumpstartafrica.org")) return null;
  return `${url.origin}${url.pathname}${url.search}`;
}
