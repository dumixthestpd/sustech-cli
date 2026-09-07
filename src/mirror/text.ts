/**
 * sustech-cli mirror.text — human-readable formatters for mirror output.
 *
 * Mirrors the conventions used by other sustech-cli modules (faculty,
 * online, transit): one `format*` function per CLI output shape,
 * taking the data + a title and returning a single string.
 *
 * Output modes are NOT handled here — the CLI layer calls these
 * formatters and either prints the string as-is (text mode) or
 * serializes the input data as JSON (json mode).
 */
import type { MirrorSyllabus, MirrorTrainingProgram } from "./types.js";

/** Format the result of `exists` for a single course code. */
export function formatSyllabusStatus(code: string, exists: boolean, url: string): string {
  if (exists) {
    return `✅ ${code.toUpperCase()}  ${url}`;
  }
  return `❌ ${code.toUpperCase()}  (no syllabus on mirror; expected at ${url})`;
}

/** Format the list of URLs (one per line, for the `url` subcommand). */
export function formatSyllabusUrls(codes: readonly string[], urlOf: (code: string) => string): string {
  return codes.map((c) => urlOf(c)).join("\n");
}

/** Format a list of downloaded syllabus paths (one per line). */
export function formatSyllabusDownloads(downloads: ReadonlyArray<{ code: string; path: string }>): string {
  if (downloads.length === 0) return "No syllabi downloaded.";
  return [
    `Syllabus downloads · ${downloads.length}`,
    ...downloads.map((d) => `  ✅ ${d.code}  →  ${d.path}`),
  ].join("\n");
}

/** Format a MirrorSyllabus as a single-line summary. */
export function formatSyllabusSummary(s: MirrorSyllabus): string {
  return [
    `Course: ${s.code}`,
    `  PDF:  ${s.pdfUrl}`,
    s.htmlUrl ? `  HTML: ${s.htmlUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Format a list of training-program URLs. */
export function formatTrainingProgramUrls(programs: readonly MirrorTrainingProgram[]): string {
  if (programs.length === 0) return "No training-program years found.";
  return [
    `Training-program compendia · ${programs.length}`,
    ...programs.map((p) => `  ${p.year}  →  ${p.pdfUrl}`),
  ].join("\n");
}

/** Format a list of raw URLs (used by `mirror list <subpath>`). */
export function formatUrlList(rows: readonly string[]): string {
  if (rows.length === 0) return "(empty directory listing)";
  return rows.join("\n");
}

/** Format the entries of a mirror directory listing (`mirror list`). */
export function formatIndexEntries(entries: ReadonlyArray<{ href: string; name: string; directory: boolean }>): string {
  if (entries.length === 0) return "(empty directory listing)";
  return [
    `Mirror directory entries · ${entries.length}`,
    ...entries.map((e) => `  ${e.directory ? "📁" : "📄"} ${e.name}  (${e.href})`),
  ].join("\n");
}

/** Format the available training-program years (`mirror program years`). */
export function formatTrainingProgramYears(years: readonly string[]): string {
  if (years.length === 0) return "No training-plan years found (mirror may be down).";
  return [
    `Available training-plan years · ${years.length}`,
    ...years.map((y) => `  ${y}`),
  ].join("\n");
}

/** Format the TIS-backed course info (`mirror course`, text mode). */
export function formatMirrorCourse(info: {
  code: string;
  name: string;
  nameEn?: string;
  department?: string;
  credits?: number | null;
  courseType?: string;
  courseCategory?: string;
  semester?: string;
  score?: string;
  rank?: string;
  classSize?: string;
  source: string;
}): string {
  const lines = [`Course: ${info.code} ${info.name}`];
  if (info.nameEn) lines.push(`  English: ${info.nameEn}`);
  if (info.department) lines.push(`  Department: ${info.department}`);
  if (info.credits !== null && info.credits !== undefined) lines.push(`  Credits: ${info.credits}`);
  if (info.courseType) lines.push(`  Type: ${info.courseType}`);
  if (info.courseCategory) lines.push(`  Category: ${info.courseCategory}`);
  if (info.semester) lines.push(`  Semester: ${info.semester}`);
  if (info.score) lines.push(`  Score: ${info.score} (rank ${info.rank ?? "?"}/${info.classSize ?? "?"})`);
  lines.push(`  Source: ${info.source}`);
  return lines.join("\n");
}

/** Format the extracted PDF text. Long output is truncated for terminal use. */
export function formatExtractedText(code: string, text: string, maxChars = 4000): string {
  const head = text.length > maxChars ? text.slice(0, maxChars) + "\n…(truncated)…" : text;
  return [
    `Syllabus text · ${code}  (${text.length.toLocaleString()} chars total)`,
    "─".repeat(40),
    head,
  ].join("\n");
}
