/**
 * The single tenant the app serves today. Every domain entity carries an
 * `ownerId` so the future multi-tenant / Salla-OAuth migration is a swap (set
 * the real owner from the authenticated request) rather than a rewrite.
 *
 * TODO(multitenancy): replace with the authenticated owner resolved from the
 * Salla OAuth session.
 */
export const DEFAULT_OWNER = 'default';
