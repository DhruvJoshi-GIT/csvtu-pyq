// Fix the over-nesting from group-fixup.ts.
// For each "<name>-base" folder inside a topic folder, anything that is NOT
// a year folder (4-digit YYYY) should be lifted out one level.
// Only the actual year folders (with PDFs from the bare-name subject) stay
// inside <name>-base.

import { readdir, stat, rename, rmdir } from "node:fs/promises";
import { join } from "node:path";

const ROOT = "D:/CLaude/PYQ";

function isYearName(name: string): boolean {
  return /^(19|20)\d{2}$/.test(name) || name === "unknown-year";
}

async function isDir(p: string): Promise<boolean> {
  try { return (await stat(p)).isDirectory(); } catch { return false; }
}

async function fixBaseFolder(baseDir: string, topicDir: string): Promise<number> {
  let lifted = 0;
  for (const entry of await readdir(baseDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (isYearName(entry.name)) continue; // legitimately stays inside <name>-base
    // It's a subject folder — lift it up to the topic level
    const src = join(baseDir, entry.name);
    const dst = join(topicDir, entry.name);
    try {
      await rename(src, dst);
      lifted++;
    } catch (e: any) {
      console.error(`  Lift failed ${src} -> ${dst}: ${e.message}`);
    }
  }
  return lifted;
}

async function walkTopics(parent: string): Promise<void> {
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(parent, entry.name);
    // Detect topic folder by PascalCase-with-dashes naming
    if (!/^[A-Z][A-Za-z]+(-[A-Z][A-Za-z]+|-and-)*$/.test(entry.name) && !/^[A-Z][A-Za-z\-]+$/.test(entry.name)) {
      continue;
    }
    // Look for <name>-base subfolder
    for (const sub of await readdir(dir, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue;
      if (!sub.name.endsWith("-base")) continue;
      const baseDir = join(dir, sub.name);
      const lifted = await fixBaseFolder(baseDir, dir);
      if (lifted) {
        console.log(`  ${baseDir}: lifted ${lifted} subject(s) to ${dir}`);
      }
    }
  }
}

async function main() {
  // Walk all course/branch/sem dirs and find topic folders inside them
  for (const course of await readdir(ROOT, { withFileTypes: true })) {
    if (!course.isDirectory() || course.name.startsWith("_")) continue;
    const courseDir = join(ROOT, course.name);
    for (const top of await readdir(courseDir, { withFileTypes: true })) {
      if (!top.isDirectory()) continue;
      const topPath = join(courseDir, top.name);
      if (top.name.startsWith("Sem-") || top.name === "Unknown-Sem" || top.name === "1st-Year") {
        await walkTopics(topPath);
      } else {
        for (const sem of await readdir(topPath, { withFileTypes: true })) {
          if (!sem.isDirectory()) continue;
          const semPath = join(topPath, sem.name);
          await walkTopics(semPath);
        }
      }
    }
  }
  console.log("Done.");
}

main().catch(e => { console.error(e); process.exit(1); });
