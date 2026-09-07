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

/** Known handbook documents on the mirror (add more as we discover them). */
export const HANDBOOK_KINDS: Record<string, string> = {
  "freshman-2022": "/site/sustech-online/documents/freshman-handbook/2022.pdf",
};

/**
 * Training-program year entries probed by `program years`. Most years are
 * subdirectories; 2025+ ship as a single per-year compendium PDF. 2018 has
 * two subdirs (apply-at-end-of-year-1 vs year-2).
 */
export const TRAINING_PROGRAM_YEAR_CANDIDATES: ReadonlyArray<{ label: string; path: string }> = [
  { label: "2018级本科人才培养方案（适用于第一学年结束时，申请进入专业）", path: "2018级本科人才培养方案（适用于第一学年结束时，申请进入专业）/" },
  { label: "2018级本科人才培养方案（适用于第二学年结束时，申请进入专业）", path: "2018级本科人才培养方案（适用于第二学年结束时，申请进入专业）/" },
  { label: "2019级本科人才培养方案", path: "2019级本科人才培养方案/" },
  { label: "2020级本科人才培养方案", path: "2020级本科人才培养方案/" },
  { label: "2021级本科人才培养方案", path: "2021级本科人才培养方案/" },
  { label: "2022级本科人才培养方案", path: "2022级本科人才培养方案/" },
  { label: "2023级本科人才培养方案", path: "2023级本科人才培养方案/" },
  { label: "2024级本科人才培养方案", path: "2024级本科人才培养方案/" },
  { label: "2025级本科人才培养方案", path: "2025级本科人才培养方案.pdf" },
  { label: "2026级本科人才培养方案", path: "2026级本科人才培养方案.pdf" },
];

/** Normalize a training-program year: "2024" and "2024级" → "2024级". */
export function normalizeTrainingYear(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || trimmed.endsWith("级")) return trimmed;
  return `${trimmed}级`;
}

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60_000;
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

  /** Download a per-year training-program PDF. Throws on 404 / transport error. */
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

  // -- Directory listings, handbook, campus map ------------------------------

  /** True iff a path under the mirror root exists (HEAD probe). */
  async existsPath(path: string, options: MirrorFetchOptions = {}): Promise<boolean> {
    const url = `${MIRROR_BASE}/${path.replace(/^\/+/, "")}`;
    const timeoutMs = options.timeoutMs ?? this.defaultProbeTimeoutMs;
    const init: RequestInit = {
      method: "HEAD",
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    };
    if (this.userAgent) init.headers = { "user-agent": this.userAgent };
    try {
      const response = await fetch(url, init);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Fetch the raw HTML of a mirror autoindex page (Nginx directory index).
   * Throws on 403 (listing disabled) / transport error.
   */
  async fetchIndexHtml(subpath: string, options: MirrorFetchOptions = {}): Promise<string> {
    const url = `${MIRROR_BASE}/${subpath.replace(/^\/+/, "")}/`;
    const timeoutMs = options.timeoutMs ?? this.defaultProbeTimeoutMs;
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
    if (response.status === 403) {
      throw new MirrorError("forbidden", `directory listing disabled for ${url} (403)`, url, 403);
    }
    if (response.status === 404) {
      throw new MirrorError("not_found", `no such directory on the mirror: ${url}`, url, 404);
    }
    if (!response.ok) {
      throw new MirrorError("upstream", `mirror returned ${response.status} for ${url}`, url, response.status);
    }
    return await response.text();
  }

  /**
   * Parse a mirror autoindex HTML page into entries. Parent links ("../")
   * and query-string links are dropped.
   */
  parseIndexEntries(html: string): Array<{ href: string; name: string; directory: boolean }> {
    const entries: Array<{ href: string; name: string; directory: boolean }> = [];
    const anchorRe = /<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
    let match: RegExpExecArray | null;
    while ((match = anchorRe.exec(html)) !== null) {
      const href = match[1];
      if (href === "../" || href === "/" || href === "" || href.startsWith("?")) continue;
      entries.push({
        href,
        name: match[2],
        directory: href.endsWith("/"),
      });
    }
    return entries;
  }

  /** Download a known handbook PDF (see HANDBOOK_KINDS). */
  async fetchHandbook(kind: string, options: MirrorFetchOptions = {}): Promise<Uint8Array> {
    const path = HANDBOOK_KINDS[kind];
    if (!path) {
      throw new MirrorError(
        "not_found",
        `unknown handbook kind: ${JSON.stringify(kind)}. Known: ${Object.keys(HANDBOOK_KINDS).join(", ")}`,
        `${MIRROR_BASE}${CAMPUS_MAP_PREFIX}`,
      );
    }
    return this.fetchFile(path, options);
  }

  /**
   * Download the latest campus-map PDF. The exact filename changes per
   * release (v4-1, v4-2, ...), so the directory index is probed for PDFs;
   * falls back to the known v4-1 name.
   */
  async fetchCampusMap(options: MirrorFetchOptions = {}): Promise<{ bytes: Uint8Array; path: string }> {
    const candidates: string[] = [];
    try {
      const html = await this.fetchIndexHtml(CAMPUS_MAP_PREFIX.replace(/^\//, ""), options);
      for (const entry of this.parseIndexEntries(html)) {
        if (/\.pdf$/i.test(entry.href)) candidates.push(entry.href);
      }
    } catch {
      // Index probing is best-effort; fall through to the hardcoded fallback.
    }
    if (candidates.length === 0) {
      candidates.push("site/sustech-online/documents/campus-map/南方科技大学校园地图-v4-1.pdf");
    }
    let lastError: unknown;
    for (const path of candidates) {
      try {
        const bytes = await this.fetchFile(path, options);
        return { bytes, path };
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof MirrorError
      ? lastError
      : new MirrorError("upstream", `could not fetch any campus map (last error: ${String(lastError)})`, `${MIRROR_BASE}${CAMPUS_MAP_PREFIX}`);
  }

  /** GET any file under the mirror root and return its bytes. */
  async fetchFile(path: string, options: MirrorFetchOptions = {}): Promise<Uint8Array> {
    const url = path.startsWith("http") ? path : `${MIRROR_BASE}/${path.replace(/^\/+/, "")}`;
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
      throw new MirrorError("not_found", `not found on the mirror (URL: ${url})`, url, 404);
    }
    if (!response.ok) {
      throw new MirrorError("upstream", `mirror returned ${response.status} for ${url}`, url, response.status);
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
