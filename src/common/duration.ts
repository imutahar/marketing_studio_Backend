// Shared video-duration parsing so billing (token cost) and the actual
// generated duration derive from ONE rule and cannot drift.

/** Matches a duration option like "12s" or "12 ث" (Arabic seconds). */
const DURATION_PATTERN = /^(\d+)\s*(?:s|ث)$/;

/**
 * Extract the selected video duration (in seconds) from the options, if any.
 * Returns `undefined` when no option encodes a duration, so callers can apply
 * their own default (or omit the value entirely).
 */
export function parseDurationSeconds(options: string[]): number | undefined {
  for (const opt of options) {
    const match = opt.match(DURATION_PATTERN);
    if (match) return Number(match[1]);
  }
  return undefined;
}
