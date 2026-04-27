// Walks public/papers/ and emits src/data/manifest.json with the full
// hierarchy + a flat paper list for client-side search.

import { readdir, stat, mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const PAPERS_ROOT = "public/papers";
const OUT_DIR = "src/data";
const OUT_FILE = "src/data/manifest.json";

type Paper = {
  id: string;            // unique slug
  course: string;
  branch: string;        // "_" if course has no branch axis
  sem: string;           // "Sem-3" / "1st-Year" / "Unknown-Sem"
  topic: string;         // "" if not grouped
  subject: string;
  year: string;          // "2019" / "unknown-year"
  filename: string;
  path: string;          // URL-style path under /papers/
  bytes: number;
};

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(p));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) out.push(p);
  }
  return out;
}

function pathSegments(rel: string): string[] {
  // Normalize separators and split
  return rel.replace(/\\/g, "/").split("/").filter(Boolean);
}

// Parse the path components into structured fields.
// Possible shapes:
//   [Course, Branch, Sem, Topic, Subject, Year, file]
//   [Course, Branch, Sem, Subject, Year, file]
//   [Course, Sem, Topic, Subject, Year, file]   (single-branch courses)
//   [Course, Sem, Subject, Year, file]
//   [Course, "1st-Year", Topic, Subject, Year, file]
//   [Course, "1st-Year", Subject, Year, file]
function parsePath(segments: string[]): Omit<Paper, "id" | "path" | "bytes"> {
  const filename = segments[segments.length - 1];
  const course = segments[0];

  // Detect single-branch courses (no branch level): segment[1] looks like Sem-N or 1st-Year
  const isSemSeg = (s: string) => /^Sem-\d+$/.test(s) || s === "Unknown-Sem" || s === "1st-Year";

  let i = 1;
  let branch = "_";
  if (!isSemSeg(segments[i])) {
    branch = segments[i];
    i++;
  }
  const sem = segments[i++]; // Sem-N / 1st-Year / Unknown-Sem

  // Detect topic (PascalCase-with-dashes folder) vs subject (lowercase-with-dashes)
  // Topic-name pattern: starts with uppercase letter
  let topic = "";
  if (i < segments.length - 2 && /^[A-Z]/.test(segments[i])) {
    topic = segments[i];
    i++;
  }
  const subject = segments[i++];
  const year = segments[i++];
  // segments[i] would be the filename (already pulled into `filename`)

  return { course, branch, sem, topic, subject, year, filename };
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

  // Build hierarchy index: course -> branch -> sem -> topic -> subject -> [years]
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
    if (!s.subjects.has(subjKey)) {
      s.subjects.set(subjKey, { name: p.subject, topic: p.topic, years: new Set(), count: 0 });
    }
    const subj = s.subjects.get(subjKey)!;
    subj.years.add(p.year);
    subj.count++;
    if (p.topic) s.topics.add(p.topic);
  }

  // Convert to plain JSON-friendly structures
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
        })).sort((a, b) => a.name.localeCompare(b.name)),
      })).sort((a, b) => a.name.localeCompare(b.name)),
    })).sort((a, b) => a.name.localeCompare(b.name)),
  })).sort((a, b) => a.name.localeCompare(b.name));

  // Stats
  const totalSize = papers.reduce((a, p) => a + p.bytes, 0);
  const stats = {
    totalPapers: papers.length,
    totalSizeBytes: totalSize,
    courses: tree.length,
    generatedAt: new Date().toISOString(),
  };

  await mkdir(OUT_DIR, { recursive: true });
  const json = JSON.stringify({ stats, tree, papers }, null, 0);
  await writeFile(OUT_FILE, json);
  // Also place a copy in public/ so the runtime search can fetch it
  await mkdir("public", { recursive: true });
  await writeFile("public/manifest.json", json);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const sizeKB = ((await stat(OUT_FILE)).size / 1024).toFixed(0);
  process.stderr.write(`Wrote ${OUT_FILE} and public/manifest.json (${sizeKB} KB) in ${elapsed}s\n`);
  process.stderr.write(`Papers: ${papers.length}, total ${(totalSize / 1024 / 1024).toFixed(1)} MB\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
