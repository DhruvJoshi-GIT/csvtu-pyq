// Walks public/papers/ + public/syllabus/ and emits src/data/manifest.json
// with the full hierarchy + flat indexes for client-side search.

import { readdir, stat, mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { aliases as subjectAliases } from "./subject-aliases";

const PAPERS_ROOT = "public/papers";
const SYLLABUS_ROOT = "public/syllabus";
const OUT_DIR = "src/data";
const OUT_FILE = "src/data/manifest.json";

type Paper = {
  id: string;
  course: string;
  branch: string;
  sem: string;
  topic: string;
  subject: string;
  year: string;
  filename: string;
  path: string;
  bytes: number;
};

type SubjectIndex = {
  id: string;
  course: string;
  branch: string;
  sem: string;
  topic: string;
  name: string;
  years: string[];
  paperCount: number;
  href: string;
};

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return []; }
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(p));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) out.push(p);
  }
  return out;
}

function pathSegments(rel: string): string[] {
  return rel.replace(/\\/g, "/").split("/").filter(Boolean);
}

function parsePath(segments: string[]): Omit<Paper, "id" | "path" | "bytes"> {
  const filename = segments[segments.length - 1];
  const course = segments[0];
  const isSemSeg = (s: string) => /^Sem-\d+$/.test(s) || s === "Unknown-Sem" || s === "1st-Year";

  let i = 1;
  let branch = "_";
  if (!isSemSeg(segments[i])) {
    branch = segments[i];
    i++;
  }
  const sem = segments[i++];

  let topic = "";
  if (i < segments.length - 2 && /^[A-Z]/.test(segments[i])) {
    topic = segments[i];
    i++;
  }
  const subject = segments[i++];
  const year = segments[i++];

  return { course, branch, sem, topic, subject, year, filename };
}

// Build URL slug for a subject page
function subjectHref(p: { course: string; branch: string; sem: string; topic: string; subject: string }): string {
  const parts = [encodeURIComponent(p.course)];
  // Skip branch in URL when "_" — sem becomes top-level under course
  if (p.branch && p.branch !== "_") parts.push(encodeURIComponent(p.branch));
  parts.push(encodeURIComponent(p.sem));
  if (p.topic) parts.push(encodeURIComponent(p.topic));
  parts.push(encodeURIComponent(p.subject));
  return `/c/${parts.join("/")}/`;
}

async function main() {
  const startTime = Date.now();
  process.stderr.write("Walking PDF tree...\n");
  const files = await walk(PAPERS_ROOT);
  process.stderr.write(`Found ${files.length} PDFs.\n`);

  const papers: Paper[] = [];
  for (const file of files) {
    const rel = relative(PAPERS_ROOT, file);
    const segments = pathSegments(rel);
    const parsed = parsePath(segments);
    const s = await stat(file);
    const id = rel.replace(/[\\/]/g, "__").replace(/\.pdf$/, "");
    papers.push({
      ...parsed,
      id,
      path: "/papers/" + rel.replace(/\\/g, "/"),
      bytes: s.size,
    });
  }

  // Build hierarchy index
  type SubjectNode = { name: string; topic: string; years: Set<string>; count: number };
  type SemNode = { name: string; subjects: Map<string, SubjectNode>; topics: Set<string> };
  type BranchNode = { name: string; sems: Map<string, SemNode> };
  type CourseNode = { name: string; branches: Map<string, BranchNode> };
  const courses = new Map<string, CourseNode>();

  for (const p of papers) {
    if (!courses.has(p.course)) courses.set(p.course, { name: p.course, branches: new Map() });
    const c = courses.get(p.course)!;
    if (!c.branches.has(p.branch)) c.branches.set(p.branch, { name: p.branch, sems: new Map() });
    const b = c.branches.get(p.branch)!;
    if (!b.sems.has(p.sem)) b.sems.set(p.sem, { name: p.sem, subjects: new Map(), topics: new Set() });
    const s = b.sems.get(p.sem)!;
    const subjKey = p.topic ? `${p.topic}/${p.subject}` : p.subject;
    if (!s.subjects.has(subjKey)) s.subjects.set(subjKey, { name: p.subject, topic: p.topic, years: new Set(), count: 0 });
    const subj = s.subjects.get(subjKey)!;
    subj.years.add(p.year);
    subj.count++;
    if (p.topic) s.topics.add(p.topic);
  }

  const tree = [...courses.values()].map(c => ({
    name: c.name,
    branches: [...c.branches.values()].map(b => ({
      name: b.name,
      sems: [...b.sems.values()].map(s => ({
        name: s.name,
        topics: [...s.topics].sort(),
        subjects: [...s.subjects.values()].map(sub => ({
          name: sub.name,
          topic: sub.topic,
          years: [...sub.years].sort(),
          count: sub.count,
        } as any)).sort((a, b) => a.name.localeCompare(b.name)),
      })).sort((a, b) => a.name.localeCompare(b.name)),
    })).sort((a, b) => a.name.localeCompare(b.name)),
  })).sort((a, b) => a.name.localeCompare(b.name));

  // ─── Apply subject aliases ────────────────────────────────────────
  // Clone real subjects into extra sem slots so students looking in the
  // "wrong" sem still find them. The cloned entry carries an `aliasOf` field
  // so the subject page can resolve papers from the canonical location.
  const touchedSems = new Set<any>();
  for (const alias of subjectAliases) {
    const { source, also_in } = alias;
    const srcCourse = tree.find(c => c.name === source.course);
    const srcBranch = srcCourse?.branches.find(b => b.name === source.branch);
    const srcSem = srcBranch?.sems.find(s => s.name === source.sem);
    const srcSubject = srcSem?.subjects.find((s: any) =>
      s.name === source.subject && (s.topic || '') === (source.topic || '')
    );
    if (!srcSubject) {
      process.stderr.write(`alias: source not found ${JSON.stringify(source)}\n`);
      continue;
    }
    const canonicalHref = subjectHref({
      course: source.course,
      branch: source.branch,
      sem: source.sem,
      topic: source.topic || '',
      subject: source.subject,
    });

    for (const dst of also_in) {
      const dstCourseName = dst.course || source.course;
      const dstBranchName = dst.branch || source.branch;
      const dstCourse = tree.find(c => c.name === dstCourseName);
      const dstBranch = dstCourse?.branches.find(b => b.name === dstBranchName);
      const dstSem = dstBranch?.sems.find(s => s.name === dst.sem);
      if (!dstSem) {
        process.stderr.write(`alias: dst sem not found ${dstCourseName}/${dstBranchName}/${dst.sem}\n`);
        continue;
      }
      const dstTopic = dst.topic || '';
      const exists = dstSem.subjects.some((s: any) =>
        s.name === srcSubject.name && (s.topic || '') === dstTopic
      );
      if (exists) continue;

      dstSem.subjects.push({
        name: srcSubject.name,
        topic: dstTopic,
        years: srcSubject.years.slice(),
        count: srcSubject.count,
        aliasOf: {
          course: source.course,
          branch: source.branch,
          sem: source.sem,
          topic: source.topic || '',
          href: canonicalHref,
        },
      } as any);
      if (dstTopic && !dstSem.topics.includes(dstTopic)) dstSem.topics.push(dstTopic);
      touchedSems.add(dstSem);
    }
  }
  for (const s of touchedSems) {
    s.subjects.sort((a: any, b: any) => a.name.localeCompare(b.name));
    s.topics.sort();
  }

  // Build flat subjects index for search
  const subjects: SubjectIndex[] = [];
  for (const c of tree) {
    for (const b of c.branches) {
      for (const s of b.sems) {
        for (const sub of s.subjects) {
          subjects.push({
            id: `${c.name}|${b.name}|${s.name}|${sub.topic}|${sub.name}`,
            course: c.name,
            branch: b.name,
            sem: s.name,
            topic: sub.topic,
            name: sub.name,
            years: sub.years,
            paperCount: sub.count,
            href: subjectHref({ course: c.name, branch: b.name, sem: s.name, topic: sub.topic, subject: sub.name }),
          });
        }
      }
    }
  }

  // Load catalog (built separately by _scripts/catalog-build.ts)
  let catalog: any = { entries: [] };
  try {
    catalog = (await import("../src/data/catalog.json")).default;
  } catch {
    process.stderr.write("No catalog.json — schemes/syllabus will be empty.\n");
  }
  const schemesCount = catalog.entries.filter((e: any) => e.schemeLocalPath).length;
  const syllabusCount = catalog.entries.filter((e: any) => e.syllabusUrl).length;

  // Programs with at least one scheme or syllabus
  const programs = new Set<string>();
  for (const e of catalog.entries as any[]) programs.add(e.program);

  const totalSize = papers.reduce((a, p) => a + p.bytes, 0);
  const stats = {
    totalPapers: papers.length,
    totalSubjects: subjects.length,
    totalSchemes: schemesCount,
    totalSyllabus: syllabusCount,
    totalSizeBytes: totalSize,
    courses: tree.length,
    catalogPrograms: programs.size,
    generatedAt: new Date().toISOString(),
  };

  await mkdir(OUT_DIR, { recursive: true });
  const json = JSON.stringify({ stats, tree, papers, subjects, catalog: catalog.entries }, null, 0);
  await writeFile(OUT_FILE, json);
  await mkdir("public", { recursive: true });
  await writeFile("public/manifest.json", json);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const sizeKB = ((await stat(OUT_FILE)).size / 1024).toFixed(0);
  process.stderr.write(`\nWrote ${OUT_FILE} and public/manifest.json (${sizeKB} KB) in ${elapsed}s\n`);
  process.stderr.write(`Papers: ${papers.length} | Subjects: ${subjects.length} | Schemes: ${schemesCount} | Syllabus: ${syllabusCount}\n`);
  process.stderr.write(`Total PYQ size: ${(totalSize / 1024 / 1024).toFixed(1)} MB\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
