/**
 * sustech-cli mirror.client — live client for the SUSTech CRA mirror.
 *
 * Mirrors the Python port at sustech_survival.mirror.syllabus so the
 * two CLIs return the same URLs and the same errors. Differences from
 * the Python port are intentional: TS uses built-in fetch (no
 * `requests` import), URL building uses `URL` instead of f-strings,
 * PDF text extraction is opt-in (see extractText()).
 *
 * Usage:
 *   const client = new MirrorClient();
 *   const url = client.syllabusUrl("CLE022");
 *   const exists = await client.exists("CLE022");
 *   const bytes = await client.fetchPdf("CLE022");
 *
 * All public methods are safe to call without auth — the mirror is
 * unauthenticated. The fetchPdf() / extractText() methods will throw
 * a MirrorError with `code: "not_found"` on a 404, or `code: "network"`
 * on a transport failure.
 */
import { fetchText } from "../core/http.js";
import {
  MirrorError,
  type MirrorFetchOptions,
  type MirrorSyllabus,
  type MirrorTrainingProgram,
} from "./types.js";

/** Base URL of the SUSTech open-source mirror. Unauthenticated. */
export const MIRROR_BASE = "https://mirrors.sustech.edu.cn";

/** Path prefix for syllabus PDFs on the mirror. */
export const SYLLABUS_PREFIX = "/courses/syllabus";

/** Path to the per-department syllabus aggregate directory. */
export const AGGREGATE_PREFIX = "/courses/教学大纲汇总";

/** Path to undergrad training-program compendia. */
export const PROGRAM_PREFIX = "/courses/本科人才培养方案";

/** Path to the campus-map PDFs. */
export const CAMPUS_MAP_PREFIX = "/site/sustech-online/documents/campus-map";

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 20_000;
const DEFAULT_PROBE_TIMEOUT_MS = 10_000;

/** Normalize a course code: strip whitespace, uppercase. */
export function normalizeCourseCode(raw: string): string {
  return (raw ?? "").trim().toUpperCase();
}

export class MirrorClient {
  /** Per-request timeout in ms for downloads (default 20s). */
  readonly defaultDownloadTimeoutMs: number;
  /** Per-request timeout in ms for HEAD/listing probes (default 10s). */
  readonly defaultProbeTimeoutMs: number;
  /** User-Agent override (default: the same UA used by sustech-cli core). */
  readonly userAgent: string | undefined;

  constructor(options: { downloadTimeoutMs?: number; probeTimeoutMs?: number; userAgent?: string } = {}) {
    this.defaultDownloadTimeoutMs = options.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
    this.defaultProbeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    this.userAgent = options.userAgent;
  }

  // -- URL builders (pure, no network) --------------------------------------

  /** Mirror URL for one syllabus PDF. */
  syllabusUrl(code: string): string {
    return `${MIRROR_BASE}${SYLLABUS_PREFIX}/${normalizeCourseCode(code)}.pdf`;
  }

  /** Mirror URL for one syllabus HTML rendering, if it exists. */
  syllabusHtmlUrl(code: string): string {
    return `${MIRROR_BASE}${SYLLABUS_PREFIX}/html/${normalizeCourseCode(code)}.html`;
  }

  /** Mirror URL for a per-year training-program PDF. */
  trainingProgramUrl(year: string): string {
    return `${MIRROR_BASE}${PROGRAM_PREFIX}/${year}本科人才培养方案.pdf`;
  }

  // -- HEAD probes -----------------------------------------------------------

  /** True iff a syllabus PDF exists at the mirror. Throws on transport failure. */
  async exists(code: string, options: MirrorFetchOptions = {}): Promise<boolean> {
    const url = this.syllabusUrl(code);
    const timeoutMs = options.timeoutMs ?? this.defaultProbeTimeoutMs;
    const init: RequestInit = {
      method: "HEAD",
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    };
    if (this.userAgent) init.headers = { "user-agent": this.userAgent };
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      throw new MirrorError(
        "network",
        `HEAD ${url} failed: ${err instanceof Error ? err.message : String(err)}`,
        url,
      );
    }
    return response.ok;
  }

  // -- PDF downloads ---------------------------------------------------------

  /** Download a syllabus PDF as raw bytes. Throws on 404 / transport error. */
  async fetchPdf(code: string, options: MirrorFetchOptions = {}): Promise<Uint8Array> {
    const url = this.syllabusUrl(code);
    const timeoutMs = options.timeoutMs ?? this.defaultDownloadTimeoutMs;
    const init: RequestInit = {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    };
    if (this.userAgent) init.headers = { "user-agent": this.userAgent };
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      throw new MirrorError(
        "network",
        `GET ${url} failed: ${err instanceof Error ? err.message : String(err)}`,
        url,
      );
    }
    if (response.status === 404) {
      throw new MirrorError(
        "not_found",
        `no syllabus on mirror for course ${JSON.stringify(code)} (URL: ${url})`,
        url,
        404,
      );
    }
    if (!response.ok) {
      throw new MirrorError(
        "upstream",
        `mirror returned ${response.status} for ${url}`,
        url,
        response.status,
      );
    }
    const buf = await response.arrayBuffer();
    return new Uint8Array(buf);
  }

  // -- Optional PDF text extraction -----------------------------------------
  //
  // Best-effort: relies on `pdf-parse` being installed. We don't want to
  // force a 15MB+ native dep on users who only use the URL/exists/get
  // surface, so the import is dynamic. If the dep is missing and the
  // caller asks for text, we throw a clear MirrorError.

  /**
   * Extract plain text from a syllabus PDF.
   *
   * Returns the concatenated text of every page, separated by form
   * feeds (`\f`). Returns an empty string for scanned-image syllabi
   * (pypdf/pdf-parse are text-only — no OCR). Throws if `pdf-parse`
   * isn't installed.
   */
  async extractText(pdfBytes: Uint8Array): Promise<string> {
    let pdfParse: (data: Buffer | Uint8Array) => Promise<{ text: string }>;
    try {
      // pdf-parse is a CommonJS module; use a default-import pattern.
      const mod = await import("pdf-parse" as string);
      pdfParse = (mod as { default: typeof pdfParse }).default ?? (mod as unknown as typeof pdfParse);
    } catch (err) {
      throw new MirrorError(
        "parse",
        `PDF text extraction requires the optional 'pdf-parse' dependency — ` +
          `install with: npm install pdf-parse (${err instanceof Error ? err.message : String(err)})`,
        "(no URL — local PDF bytes)",
      );
    }
    try {
      // pdf-parse expects a Buffer; copy bytes into one to avoid
      // surprising shared-memory aliasing.
      const buf = Buffer.from(pdfBytes);
      const result = await pdfParse(buf);
      return result.text ?? "";
    } catch (err) {
      throw new MirrorError(
        "parse",
        `failed to extract PDF text: ${err instanceof Error ? err.message : String(err)}`,
        "(no URL — local PDF bytes)",
      );
    }
  }

  // -- Training programs -----------------------------------------------------

  /** Download a per-year training-program PDF. */
  async fetchTrainingProgram(year: string, options: MirrorFetchOptions = {}): Promise<Uint8Array> {
    const url = this.trainingProgramUrl(year);
    const timeoutMs = options.timeoutMs ?? this.defaultDownloadTimeoutMs;
    const init: RequestInit = {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    };
    if (this.userAgent) init.headers = { "user-agent": this.userAgent };
    const response = await fetch(url, init);
    if (response.status === 404) {
      throw new MirrorError(
        "not_found",
        `no training program on mirror for year ${JSON.stringify(year)} (URL: ${url})`,
        url,
        404,
      );
    }
    if (!response.ok) {
      throw new MirrorError(
        "upstream",
        `mirror returned ${response.status} for ${url}`,
        url,
        response.status,
      );
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  // -- Convenience: probe-and-fetch ----------------------------------------

  /** Probe + download in one call. Throws on 404 / transport error. */
  async getSyllabus(code: string, options: MirrorFetchOptions = {}): Promise<MirrorSyllabus> {
    const exists = await this.exists(code, options);
    if (!exists) {
      throw new MirrorError(
        "not_found",
        `no syllabus on mirror for course ${JSON.stringify(code)}`,
        this.syllabusUrl(code),
        404,
      );
    }
    // The HTML rendering is optional — try a HEAD but don't fail if
    // the mirror returns 403 (directory listings are aggressively
    // rate-limited; the HTML folder may not be indexable).
    let htmlExists = false;
    try {
      const init: RequestInit = {
        method: "HEAD",
        signal: AbortSignal.timeout(options.timeoutMs ?? this.defaultProbeTimeoutMs),
        redirect: "follow",
      };
      if (this.userAgent) init.headers = { "user-agent": this.userAgent };
      const r = await fetch(this.syllabusHtmlUrl(code), init);
      htmlExists = r.ok;
    } catch {
      htmlExists = false;
    }
    return {
      code: normalizeCourseCode(code),
      pdfUrl: this.syllabusUrl(code),
      htmlUrl: htmlExists ? this.syllabusHtmlUrl(code) : null,
    };
  }
}
