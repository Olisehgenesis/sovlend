const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "host.docker.internal"] as const;

export function isLocalAuthHost(hostname: string): boolean {
  return (LOOPBACK_HOSTS as readonly string[]).includes(hostname);
}

export function trustedOriginsForAuthUrl(
  baseUrl: string,
  extraOrigins: readonly string[] = [],
): string[] {
  const authUrl = new URL(baseUrl);
  const origins = new Set<string>([authUrl.origin]);

  if (isLocalAuthHost(authUrl.hostname)) {
    for (const host of LOOPBACK_HOSTS) {
      origins.add(`http://${host}`);
      origins.add(`http://${host}:*`);
    }
  }

  for (const origin of extraOrigins) {
    const trimmed = origin.trim();
    if (trimmed) origins.add(trimmed.replace(/\/$/, ""));
  }

  return [...origins];
}

export function extraTrustedOriginsFromEnv(value = process.env.BETTER_AUTH_TRUSTED_ORIGINS): string[] {
  if (!value?.trim()) return [];
  return value.split(",").map((origin) => origin.trim()).filter(Boolean);
}
