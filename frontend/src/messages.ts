export const REASONS = [
  "BAD_USERNAME",
  "BAD_GIST_ID",
  "ALREADY_CLAIMED",
  "GIST_NOT_FOUND",
  "GIST_NOT_PUBLIC",
  "GIST_WRONG_OWNER",
  "GIST_MISSING_PROOF",
  "PROFILE_NOT_FOUND",
  "SOURCE_UNAVAILABLE",
] as const;

export type ReasonCode = (typeof REASONS)[number];

const MESSAGES: Record<ReasonCode, string> = {
  BAD_USERNAME: "GitHub usernames are 1–39 letters, numbers or hyphens.",
  BAD_GIST_ID: "That gist ID is not valid. Copy the ID from the gist URL.",
  ALREADY_CLAIMED: "Another wallet already claimed that GitHub account.",
  GIST_NOT_FOUND: "GitHub could not find that gist. Check the ID and that it is public.",
  GIST_NOT_PUBLIC: "That gist is secret. Create a public gist and try again.",
  GIST_WRONG_OWNER: "That gist belongs to a different GitHub account.",
  GIST_MISSING_PROOF: "The gist does not contain the exact proof line for this wallet.",
  PROFILE_NOT_FOUND: "GitHub could not find that username.",
  SOURCE_UNAVAILABLE: "GitHub was unreachable or rate-limited. Try again in a minute.",
};

export function isReason(value: string): value is ReasonCode {
  return (REASONS as readonly string[]).includes(value);
}

export function friendlyReason(value: string | undefined): string {
  if (value && isReason(value)) return MESSAGES[value];
  return "The contract rejected this verification. Open the transaction for details.";
}
