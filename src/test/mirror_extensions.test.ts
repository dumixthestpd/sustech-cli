import assert from "node:assert/strict";
import test from "node:test";
import {
  HANDBOOK_KINDS,
  MirrorClient,
  normalizeTrainingYear,
  TRAINING_PROGRAM_YEAR_CANDIDATES,
} from "../mirror/client.js";
import {
  formatIndexEntries,
  formatMirrorCourse,
  formatTrainingProgramYears,
} from "../mirror/text.js";

const client = new MirrorClient();

test("normalizeTrainingYear appends 级 only when missing", () => {
  assert.equal(normalizeTrainingYear("2024"), "2024级");
  assert.equal(normalizeTrainingYear("2024级"), "2024级");
  assert.equal(normalizeTrainingYear(" 2024 "), "2024级");
  assert.equal(normalizeTrainingYear(""), "");
});

test("trainingProgramUrl builds the compendium URL", () => {
  assert.equal(
    client.trainingProgramUrl("2024级"),
    "https://mirrors.sustech.edu.cn/courses/本科人才培养方案/2024级本科人才培养方案.pdf",
  );
});

test("parseIndexEntries extracts anchors and drops parent/query links", () => {
  const html = [
    '<a href="../">parent</a>',
    '<a href="/">root</a>',
    '<a href="?C=N;O=D">sort</a>',
    '<a href="html/">html/</a>',
    '<a href="CLE022.pdf">CLE022.pdf</a>',
  ].join("\n");
  const entries = client.parseIndexEntries(html);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], { href: "html/", name: "html/", directory: true });
  assert.deepEqual(entries[1], { href: "CLE022.pdf", name: "CLE022.pdf", directory: false });
});

test("parseIndexEntries returns empty for SPA pages with no file anchors", () => {
  const entries = client.parseIndexEntries("<!DOCTYPE html><html><body><script>window.app={}</script></body></html>");
  assert.equal(entries.length, 0);
});

test("formatIndexEntries marks directories and files", () => {
  const text = formatIndexEntries([
    { href: "html/", name: "html/", directory: true },
    { href: "CLE022.pdf", name: "CLE022.pdf", directory: false },
  ]);
  assert.match(text, /📁 html\//);
  assert.match(text, /📄 CLE022\.pdf/);
});

test("formatTrainingProgramYears lists found years", () => {
  const text = formatTrainingProgramYears(["2019级本科人才培养方案", "2024级本科人才培养方案"]);
  assert.match(text, /· 2/);
  assert.match(text, /2019级本科人才培养方案/);
});

test("formatMirrorCourse renders grade-backed info with score line", () => {
  const text = formatMirrorCourse({
    code: "CLE022",
    name: "SUSTech English II",
    nameEn: "SUSTech English II",
    department: "语言中心",
    credits: 4,
    courseType: "必修",
    semester: "2024秋季",
    score: "A",
    source: "tis_grades",
  });
  assert.match(text, /Course: CLE022 SUSTech English II/);
  assert.match(text, /Credits: 4/);
  assert.match(text, /Score: A \(rank \?\/\?\)/);
  assert.match(text, /Source: tis_grades/);
});

test("formatMirrorCourse omits absent optional fields", () => {
  const text = formatMirrorCourse({ code: "MSE202", name: "物理化学", credits: null, source: "tis_catalog" });
  assert.doesNotMatch(text, /Credits:/);
  assert.doesNotMatch(text, /Department:/);
  assert.doesNotMatch(text, /Score:/);
});

test("handbook kinds and training-program candidates are non-empty catalogs", () => {
  assert.ok(Object.keys(HANDBOOK_KINDS).length >= 1);
  assert.ok(HANDBOOK_KINDS["freshman-2022"].includes("freshman-handbook"));
  assert.ok(TRAINING_PROGRAM_YEAR_CANDIDATES.length >= 7);
  assert.ok(TRAINING_PROGRAM_YEAR_CANDIDATES.every((c) => c.label.length > 0 && c.path.length > 0));
});
