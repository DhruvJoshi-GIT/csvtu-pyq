// Final sweep: find any folder that mixes "year folders" (1900-2099) and
// "subject folders" (anything else) at the same level. This indicates a
// Windows case-collision where a subject folder accidentally became a
// topic folder during earlier passes.
//
// For each such conflict, separate them into <Topic>/<original>-base/<years>
// and <Topic>/<other-subjects>.

import { readdir, stat, rename, mkdir, rmdir } from "node:fs/promises";
import { join } from "node:path";

const ROOT = "D:/CLaude/PYQ";

function isYearName(name: string): boolean {
  return /^(19|20)\d{2}$/.test(name) || name === "unknown-year";
}

// Map a lowercase folder name to a proper Title-Case-with-dashes topic name
function titleCase(name: string): string {
  return name.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("-");
}

async function isDir(p: string): Promise<boolean> {
  try { return (await stat(p)).isDirectory(); } catch { return false; }
}

async function listDirs(p: string): Promise<string[]> {
  const entries = await readdir(p, { withFileTypes: true });
  return entries.filter(e => e.isDirectory()).map(e => e.name);
}

async function processFolder(folderPath: string, parentPath: string, folderName: string): Promise<boolean> {
  const children = await listDirs(folderPath);
  const yearChildren = children.filter(isYearName);
  const otherChildren = children.filter(c => !isYearName(c));

  // Conflict pattern: BOTH year folders AND non-year subject folders inside
  if (yearChildren.length === 0 || otherChildren.length === 0) return false;

  // Plan: rename the conflicted folder to a temp name, recreate properly cased
  // topic folder, place year content under "<name>-base", and lift other subjects
  // up into the topic.
  const properTopic = titleCase(folderName);
  const tempPath = join(parentPath, `__sweep_tmp__${folderName}`);

  console.log(`  ${folderPath}: separating ${yearChildren.length} year folders into ${properTopic}/${folderName}-base/, lifting ${otherChildren.length} sibling subjects`);

  // Step 1: rename conflicted folder to temp
  await rename(folderPath, tempPath);

  // Step 2: create proper-cased topic
  // (mkdir on Windows with a casing-different name reuses the same path due to case-insensitivity,
  // but since we just renamed away from it, the path is now free.)
  const topicPath = join(parentPath, properTopic);
  await mkdir(topicPath, { recursive: true });

  // Step 3: create base subfolder for the year content
  const baseSubject = `${folderName}-base`;
  const basePath = join(topicPath, baseSubject);
  await mkdir(basePath, { recursive: true });

  // Step 4: move year folders into base
  for (const y of yearChildren) {
    const src = join(tempPath, y);
    const dst = join(basePath, y);
    await rename(src, dst);
  }

  // Step 5: move other subject folders to topic level
  for (const sub of otherChildren) {
    const src = join(tempPath, sub);
    const dst = join(topicPath, sub);
    try {
      await rename(src, dst);
    } catch (e: any) {
      // Destination may exist if it matches another existing subject;
      // merge contents instead
      console.error(`  Conflict moving ${src} -> ${dst}: ${e.message}; merging`);
      const dstChildren = await listDirs(dst).catch(() => []);
      for (const yc of await listDirs(src)) {
        const srcC = join(src, yc);
        const dstC = join(dst, yc);
        try {
          await rename(srcC, dstC);
        } catch {}
      }
      try { await rmdir(src); } catch {}
    }
  }

  // Step 6: remove the now-empty temp folder
  try { await rmdir(tempPath); } catch {}
  return true;
}

async function walkSems(parent: string): Promise<void> {
  // Walk every folder. At each level, check if any subject folder has the conflict pattern.
  const entries = await readdir(parent, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith("__sweep_tmp__")) continue;
    const dir = join(parent, e.name);
    // Check this folder for conflict pattern
    await processFolder(dir, parent, e.name);
  }
}

async function main() {
  // Walk: ROOT/Course/(Branch/)Sem-N/ and check folders inside Sem-N
  for (const course of await readdir(ROOT, { withFileTypes: true })) {
    if (!course.isDirectory() || course.name.startsWith("_")) continue;
    const courseDir = join(ROOT, course.name);
    for (const top of await readdir(courseDir, { withFileTypes: true })) {
      if (!top.isDirectory()) continue;
      const topPath = join(courseDir, top.name);
      if (top.name.startsWith("Sem-") || top.name === "Unknown-Sem" || top.name === "1st-Year") {
        await walkSems(topPath);
      } else {
        for (const sem of await readdir(topPath, { withFileTypes: true })) {
          if (!sem.isDirectory()) continue;
          const semPath = join(topPath, sem.name);
          await walkSems(semPath);
        }
      }
    }
  }
  console.log("Done.");
}

main().catch(e => { console.error(e); process.exit(1); });
