/**
 * sustech-cli mirror module — SUSTech CRA open-source mirror client.
 *
 * Adds the `sustech mirror ...` command family to sustech-cli. Source of
 * truth: https://github.com/dumixthestpd/sustech_survival (Python port
 * that originated this discovery; the TS port lives here so users on
 * either CLI get the same surface).
 *
 * The mirror at mirrors.sustech.edu.cn is maintained by SUSTech CRA
 * (Computing Resource Association). It is unauthenticated, public, and
 * hosts official SUSTech course syllabi, undergrad training programs,
 * the campus map, and more.
 *
 * Subcommand layout (after registration in src/cli.ts):
 *   mirror syllabus get <CODE>...    — download syllabus PDF(s)
 *   mirror syllabus exists <CODE>...  — HEAD probe (exit 0 if found)
 *   mirror syllabus url <CODE>...     — print URL(s); no network
 *   mirror syllabus text <CODE>...    — download + extract text (opt-in)
 *   mirror program get <YEAR>...      — undergrad training plans
 *   mirror map get                   — campus map PDF
 *   mirror list <SUBPATH>            — directory listing (best-effort)
 *
 * This module is intentionally Node-only (uses built-in fetch). PDF
 * text extraction requires the optional `pdf-parse` dependency; the
 * client probes for it at runtime and surfaces a clear error if the
 * caller asked for `.text` without it installed.
 */
export * from "./client.js";
export * from "./text.js";
export * from "./types.js";
