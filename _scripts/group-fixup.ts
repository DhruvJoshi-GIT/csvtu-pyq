// Fix-up pass: handles cases the main grouping missed.
// 1. Self-conflict: subject folder name matches topic name case-insensitively
//    → rename subject to "<topic>-base" inside the topic, preserving the year folders.
// 2. Stragglers: subjects that should match a topic but slipped past the patterns.

import { readdir, stat, rename, mkdir, rmdir } from "node:fs/promises";
import { join } from "node:path";

const ROOT = "D:/CLaude/PYQ";

// Extra patterns added based on observed stragglers
const extraRules: Array<{ topic: string; patterns: RegExp[] }> = [
  {
    topic: "Communication-and-English",
    patterns: [
      /^language\b/, /^language-/, /^foreign-language/,
    ],
  },
  {
    topic: "Mechanical-Basics",
    patterns: [
      /^fundamental-of-mechanical/, /^fundamental-of-mechanic/,
    ],
  },
  {
    topic: "Computer-Fundamentals-and-Programming",
    patterns: [
      /^programming-for-problem/, /^programming-fundamental/,
      /^introduction-to-programming/,
    ],
  },
  {
    topic: "Software-Engineering",
    patterns: [/^software-engineering$/],
  },
  {
    topic: "Physics",
    patterns: [/^physics$/],
  },
  {
    topic: "Chemistry",
    patterns: [/^chemistry$/],
  },
  {
    topic: "Mathematics",
    patterns: [/^mathematics$/, /^maths$/],
  },
];

const topicNames = new Set(extraRules.map(r => r.topic));
// Also include all known topic names from main grouping (anything PascalCase-with-dashes).
// We'll discover them by walking the tree.

function pickTopic(name: string): string | null {
  const lower = name.toLowerCase();
  for (const r of extraRules) {
    for (const p of r.patterns) {
      if (p.test(lower)) return r.topic;
    }
  }
  return null;
}

async function isDir(p: string): Promise<boolean> {
  try { return (await stat(p)).isDirectory(); } catch { return false; }
}

async function moveContents(srcDir: string, destDir: string): Promise<number> {
  await mkdir(destDir, { recursive: true });
  let moved = 0;
  for (const entry of await readdir(srcDir, { withFileTypes: true })) {
    const src = join(srcDir, entry.name);
    const dst = join(destDir, entry.name);
    try {
      await rename(src, dst);
      moved++;
    } catch (e: any) {
      console.error(`  Move failed ${src} -> ${dst}: ${e.message}`);
    }
  }
  return moved;
}

async function processSem(semDir: string): Promise<{ moves: number; conflicts: number }> {
  let moves = 0, conflicts = 0;
  const entries = await readdir(semDir, { withFileTypes: true });
  // Find existing topic folders (already PascalCase-with-dashes containing "-" or capital)
  const existingTopics = new Set<string>();
  for (const e of entries) {
    if (e.isDirectory() && /^[A-Z][A-Za-z]+(-[A-Z][A-Za-z]+)*$/.test(e.name)) {
      existingTopics.add(e.name);
    }
  }

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (existingTopics.has(e.name)) continue; // already a topic folder
    const topic = pickTopic(e.name);
    if (!topic) continue;

    const srcDir = join(semDir, e.name);
    const topicDir = join(semDir, topic);

    // Self-conflict: source name and topic name resolve to same path on Windows
    if (e.name.toLowerCase() === topic.toLowerCase()) {
      // Rename subject to "<topic>-base" inside the topic dir.
      // First, create a sibling temp dir, move contents in, then rename to final.
      const tempDir = join(semDir, `__${topic}-tmp__`);
      await mkdir(tempDir, { recursive: true });
      // Move all of source's contents into the temp dir as a subject named "general"
      const subjectDir = join(tempDir, `${e.name.toLowerCase()}-base`);
      await mkdir(subjectDir, { recursive: true });
      for (const inner of await readdir(srcDir, { withFileTypes: true })) {
        const src = join(srcDir, inner.name);
        const dst = join(subjectDir, inner.name);
        try {
          await rename(src, dst);
          moves++;
        } catch (err: any) {
          console.error(`  Inner move failed ${src} -> ${dst}: ${err.message}`);
        }
      }
      // Remove the now-empty source directory
      try { await rmdir(srcDir); } catch {}
      // Rename temp to topic (this gives us proper casing too)
      try {
        await rename(tempDir, topicDir);
      } catch (err: any) {
        // If topicDir already exists (it might, on Windows due to case mapping),
        // move temp's content into it
        for (const inner of await readdir(tempDir, { withFileTypes: true })) {
          const src = join(tempDir, inner.name);
          const dst = join(topicDir, inner.name);
          await rename(src, dst);
        }
        try { await rmdir(tempDir); } catch {}
      }
      conflicts++;
      console.log(`  ${semDir}: resolved self-conflict for "${e.name}" -> "${topic}/${e.name.toLowerCase()}-base"`);
    } else {
      // Normal move
      try {
        await mkdir(topicDir, { recursive: true });
        const dst = join(topicDir, e.name);
        await rename(srcDir, dst);
        moves++;
      } catch (err: any) {
        console.error(`  Move failed ${srcDir}: ${err.message}`);
      }
    }
  }
  return { moves, conflicts };
}

async function walk(courseDir: string): Promise<void> {
  for (const top of await readdir(courseDir, { withFileTypes: true })) {
    if (!top.isDirectory()) continue;
    const topPath = join(courseDir, top.name);
    if (top.name.startsWith("Sem-") || top.name === "Unknown-Sem" || top.name === "1st-Year") {
      const r = await processSem(topPath);
      if (r.moves || r.conflicts) {
        console.log(`  ${topPath}: moves=${r.moves} conflicts=${r.conflicts}`);
      }
    } else {
      for (const sem of await readdir(topPath, { withFileTypes: true })) {
        if (!sem.isDirectory()) continue;
        const semPath = join(topPath, sem.name);
        const r = await processSem(semPath);
        if (r.moves || r.conflicts) {
          console.log(`  ${semPath}: moves=${r.moves} conflicts=${r.conflicts}`);
        }
      }
    }
  }
}

async function main() {
  for (const course of await readdir(ROOT, { withFileTypes: true })) {
    if (!course.isDirectory() || course.name.startsWith("_")) continue;
    console.log(`Processing ${course.name}...`);
    await walk(join(ROOT, course.name));
  }
  console.log("Done.");
}

main().catch(e => { console.error(e); process.exit(1); });
