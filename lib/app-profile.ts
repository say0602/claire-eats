export type AppProfile = "private" | "public";
let warnedProfileMismatch = false;

function normalizeProfile(value: string | undefined): AppProfile | null {
  if (value === "private" || value === "public") return value;
  return null;
}

function warnProfileMismatchIfNeeded() {
  if (warnedProfileMismatch) return;
  if (process.env.NODE_ENV !== "development") return;

  const serverProfile = normalizeProfile(process.env.APP_PROFILE);
  const publicProfile = normalizeProfile(process.env.NEXT_PUBLIC_APP_PROFILE);
  if (!serverProfile || !publicProfile) return;
  if (serverProfile === publicProfile) return;

  warnedProfileMismatch = true;
  // eslint-disable-next-line no-console
  console.warn(
    "[app-profile] APP_PROFILE and NEXT_PUBLIC_APP_PROFILE differ. This can cause server/client behavior mismatch.",
    { APP_PROFILE: serverProfile, NEXT_PUBLIC_APP_PROFILE: publicProfile },
  );
}

export function getAppProfile(): AppProfile {
  // Next.js client components can only read NEXT_PUBLIC_* env variables.
  const publicProfile = normalizeProfile(process.env.NEXT_PUBLIC_APP_PROFILE);
  if (publicProfile) return publicProfile;

  return "private";
}

export function getServerAppProfile(): AppProfile {
  warnProfileMismatchIfNeeded();

  const serverProfile = normalizeProfile(process.env.APP_PROFILE);
  if (serverProfile) return serverProfile;

  const publicProfile = normalizeProfile(process.env.NEXT_PUBLIC_APP_PROFILE);
  if (publicProfile) return publicProfile;

  return "private";
}

