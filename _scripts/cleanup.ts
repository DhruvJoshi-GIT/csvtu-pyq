// Post-process: merge subject folders that differ only in residual prefix codes.
// Examples:
//   a000111-physics-1   →  physics-1
//   1-year-mathematics-2  →  mathematics-2
//   aei-me-328313-basic-electronics  →  basic-electronics
//   pe-au-337355-engineering-thermodynamics  →  engineering-thermodynamics
//   mining-6-sem-mine-ventilation-2  →  mine-ventilation-2

import { readdir, stat, rename, rmdir, mkdir } from "node:fs/promises";
import { join } from "node:path";

const ROOT = "D:/CLaude/PYQ";

// Normalize a subject folder name by stripping common residual prefix patterns
function normalize(name: string): string {
  let s = name;
  // Strip leading "1-year-"
  s = s.replace(/^1-year-/, "");
  // Strip leading "N-year-" for safety
  s = s.replace(/^\d+-year-/, "");
  // Strip leading code: alphanumeric token with digits, e.g. a000111, 322351, b022313
  s = s.replace(/^[a-z]?\d{4,8}[a-z]*\d*-/i, "");
  // Strip leading branch code prefixes followed by 6-digit code:
  //   aei-me-328313-, pe-au-337355-, etc
  s = s.replace(/^[a-z]+(-[a-z]+)?-\d{6}-/, "");
  // Strip leading "branch-N-sem-" e.g. mining-6-sem-, ete-5-sem-
  s = s.replace(/^[a-z]+-\d+-sem-/, "");
  // Strip leading "be-" (bachelor of engineering) prefix patterns
  s = s.replace(/^be-[a-z]+(-[a-z]+)?-\d+-sem-/, "");
  // Trim
  s = s.replace(/^-+|-+$/g, "");
  return s || name;
}

async function exists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

async function isDir(p: string): Promise<boolean> {
  try { return (await stat(p)).isDirectory(); } catch { return false; }
}

async function moveAll(srcDir: string, destDir: string): Promise<{ moved: number; skipped: number }> {
  let moved = 0, skipped = 0;
  await mkdir(destDir, { recursive: true });
  for (const entry of await readdir(srcDir, { withFileTypes: true })) {
    const src = join(srcDir, entry.name);
    const dst = join(destDir, entry.name);
    if (entry.isDirectory()) {
      // Recurse: merge subdirectory content (e.g. year folders)
      const r = await moveAll(src, dst);
      moved += r.moved; skipped += r.skipped;
      // Try to remove empty source after merge
      try { await rmdir(src); } catch {}
    } else {
      if (await exists(dst)) {
        skipped++;
      } else {
        await rename(src, dst);
        moved++;
      }
    }
  }
  return { moved, skipped };
}

async function processSem(semDir: string): Promise<{ merged: number; moved: number }> {
  const subjects = await readdir(semDir);
  // Group by normalized name
  const groups = new Map<string, string[]>();
  for (const name of subjects) {
    const full = join(semDir, name);
    if (!(await isDir(full))) continue;
    const norm = normalize(name);
    if (!groups.has(norm)) groups.set(norm, []);
    groups.get(norm)!.push(name);
  }
  let merged = 0, moved = 0;
  for (const [norm, names] of groups) {
    if (names.length === 1 && names[0] === norm) continue; // already canonical
    // Pick canonical destination name = norm
    const destName = norm;
    const destDir = join(semDir, destName);
    // First ensure dest exists; if there's a folder already named exactly norm, use it
    if (!(await exists(destDir))) {
      await mkdir(destDir, { recursive: true });
    }
    for (const srcName of names) {
      if (srcName === destName) continue;
      const srcDir = join(semDir, srcName);
      const r = await moveAll(srcDir, destDir);
      moved += r.moved;
      try { await rmdir(srcDir); } catch {}
      merged++;
    }
  }
  return { merged, moved };
}

async function walkSems(courseDir: string): Promise<void> {
  // courseDir contains either Sem-N folders directly, or branch folders, or 1st-Year
  for (const top of await readdir(courseDir, { withFileTypes: true })) {
    if (!top.isDirectory()) continue;
    const topPath = join(courseDir, top.name);
    if (top.name.startsWith("Sem-") || top.name === "Unknown-Sem") {
      const r = await processSem(topPath);
      if (r.merged) console.log(`  ${topPath}: merged ${r.merged} folders, moved ${r.moved} files`);
    } else if (top.name === "1st-Year") {
      const r = await processSem(topPath);
      if (r.merged) console.log(`  ${topPath}: merged ${r.merged} folders, moved ${r.moved} files`);
    } else {
      // Branch folder — recurse into its Sem-N subdirs
      for (const sem of await readdir(topPath, { withFileTypes: true })) {
        if (!sem.isDirectory()) continue;
        const semPath = join(topPath, sem.name);
        const r = await processSem(semPath);
        if (r.merged) console.log(`  ${semPath}: merged ${r.merged} folders, moved ${r.moved} files`);
      }
    }
  }
}

async function main() {
  for (const course of await readdir(ROOT, { withFileTypes: true })) {
    if (!course.isDirectory() || course.name.startsWith("_")) continue;
    console.log(`Processing ${course.name}...`);
    await walkSems(join(ROOT, course.name));
  }
  console.log("Done.");
}

main().catch(e => { console.error(e); process.exit(1); });
