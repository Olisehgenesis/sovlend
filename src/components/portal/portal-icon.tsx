import { icons } from "@dicebear/collection";
import { createAvatar } from "@dicebear/core";

export function portalIconSrc(seed: string) {
  return createAvatar(icons, {
    seed,
    radius: 50,
    backgroundColor: ["174b35", "2f6b4f", "315d7c", "b78624"],
    scale: 72,
  }).toDataUri();
}

export function PortalIcon({ seed, size = 40 }: { seed: string; size?: number }) {
  return <img alt="" aria-hidden="true" className="portal-icon" height={size} src={portalIconSrc(seed)} width={size} />;
}
