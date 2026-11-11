/**
 * Where a release's notes end and how to install it begins, in its GitHub release (ADR 0078):
 * the release workflow writes it (`scripts/release-notes.ts`), and the desktop app shows what
 * comes before it as what the release brings.
 */
export const INSTALL_MARK = "<!-- install -->";
