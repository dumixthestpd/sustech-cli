/**
 * sustech-cli mirror.types — TypeScript types for the mirror module.
 *
 * Kept intentionally narrow: this module is best-effort public data
 * and we don't want to bloat the type surface with internal structs.
 */

export interface MirrorSyllabus {
  /** TIS course code, e.g. "CLE022" — the URL basename. */
  code: string;
  /** URL of the PDF on the mirror. */
  pdfUrl: string;
  /** URL of the HTML rendering, if it exists on the mirror. */
  htmlUrl: string | null;
}

export interface MirrorTrainingProgram {
  /** Year + "级", e.g. "2024级". */
  year: string;
  /** URL of the per-year compendium PDF. */
  pdfUrl: string;
}

/** Options accepted by MirrorClient methods. */
export interface MirrorFetchOptions {
  /** Per-request timeout in ms. Defaults to 20s for downloads, 10s for probes. */
  timeoutMs?: number;
  /** Optional User-Agent override. The client sets a sensible default. */
  userAgent?: string;
}

/** Reason a syllabus or program could not be fetched. */
export type MirrorErrorCode =
  | "not_found"     // 404 from the mirror
  | "forbidden"     // 403 — directory listing disabled
  | "network"       // transport-level failure
  | "upstream"      // 5xx from the mirror
  | "parse";        // response body could not be parsed (e.g. PDF corrupt)

export class MirrorError extends Error {
  readonly code: MirrorErrorCode;
  readonly url: string;
  readonly status?: number;

  constructor(code: MirrorErrorCode, message: string, url: string, status?: number) {
    super(message);
    this.name = "MirrorError";
    this.code = code;
    this.url = url;
    this.status = status;
  }
}
