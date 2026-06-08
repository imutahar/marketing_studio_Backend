// Shared video-duration parsing so billing (token cost) and the actual
// generated duration derive from ONE rule and cannot drift.

/** Matches a duration option like "12s" or "12 ث" (Arabic seconds). */
const DURATION_PATTERN = /^(\d+)\s*(?:s|ث)$/;

/**
 * Extract a video duration (in seconds) from a single option value, if it
 * encodes one. Returns `undefined` when the value is absent or doesn't match,
 * so callers can apply their own default (or omit the value entirely).
 */
export function parseDurationSeconds(value?: string): number | undefined {
  if (!value) return undefined;
  const match = value.match(DURATION_PATTERN);
  return match ? Number(match[1]) : undefined;
}
