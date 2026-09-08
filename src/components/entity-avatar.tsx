import { createAvatar } from "@dicebear/core";
import { avataaars } from "@dicebear/collection";
import type { CSSProperties } from "react";

type AvataaarsOptions = Parameters<typeof avataaars.create>[0]["options"];

type EntityAvatarProps = {
  seed: string;
  name: string;
  genderCode?: string | null;
  photoUrl?: string | null;
  size?: number;
  className?: string;
};

// Avataaars gives us the clearest supported levers for this app's placeholders:
// stable seeds, explicit hairstyle buckets, and facial-hair probability controls.
const feminineTopOptions = [
  "bigHair",
  "bob",
  "bun",
  "curly",
  "curvy",
  "dreads",
  "frida",
  "longButNotTooLong",
  "miaWallace",
  "straight01",
  "straight02",
  "straightAndStrand",
  "frizzle",
] satisfies NonNullable<AvataaarsOptions["top"]>;

const masculineTopOptions = [
  "dreads01",
  "dreads02",
  "fro",
  "froBand",
  "shaggy",
  "shaggyMullet",
  "shavedSides",
  "shortCurly",
  "shortFlat",
  "shortRound",
  "shortWaved",
  "sides",
  "theCaesar",
  "theCaesarAndSidePart",
] satisfies NonNullable<AvataaarsOptions["top"]>;

const facialHairOptions = [
  "beardLight",
  "beardMajestic",
  "beardMedium",
  "moustacheFancy",
  "moustacheMagnum",
] satisfies NonNullable<AvataaarsOptions["facialHair"]>;

function avatarOptionsForGender(genderCode?: string | null): Partial<AvataaarsOptions> {
  if (genderCode === "Female") {
    return { top: feminineTopOptions, topProbability: 100, facialHairProbability: 0 };
  }

  if (genderCode === "Male") {
    return {
      top: masculineTopOptions,
      topProbability: 100,
      facialHair: facialHairOptions,
      facialHairProbability: 40,
    };
  }

  return {};
}

export function getEntityAvatarDataUri({ seed, genderCode }: Pick<EntityAvatarProps, "seed" | "genderCode">) {
  return createAvatar(avataaars, {
    seed,
    radius: 50,
    backgroundColor: ["dceee5"],
    ...avatarOptionsForGender(genderCode),
  }).toDataUri();
}

export function EntityAvatar({ seed, name, genderCode, photoUrl, size = 32, className }: EntityAvatarProps) {
  const src = photoUrl ?? getEntityAvatarDataUri({ seed: seed || name, genderCode });
  const style = { "--avatar-size": `${size}px` } as CSSProperties;

  return (
    <span className={["avatar", className].filter(Boolean).join(" ")} style={style}>
      <img alt="" aria-hidden="true" decoding="async" loading="lazy" src={src} />
    </span>
  );
}
