// Download PDFs from manifest.tsv with parallelism, retries, and resume support.
// Usage: bun run download.ts [filter]
//   filter: optional substring to match the course (e.g. "BTech" downloads only BTech)

import { mkdir, stat, writeFile, appendFile } from "node:fs/promises";
import { dirname } from "node:path";

const MANIFEST = "D:/CLaude/PYQ/_scripts/manifest.tsv";
const LOG_FAIL = "D:/CLaude/PYQ/_scripts/failed.log";
const PROGRESS = "D:/CLaude/PYQ/_scripts/progress.log";
const CONCURRENCY = 16;

const filter = process.argv[2] || "";

type Entry = {
  course: string; branch: string; sem: string; subject: string;
  year: string; month: string; paperUrl: string; pdfUrl: string; targetPath: string;
};

async function loadManifest(): Promise<Entry[]> {
  const text = await Bun.file(MANIFEST).text();
  const lines = text.split("\n").slice(1).filter(l => l.trim());
  return lines.map(l => {
    const parts = l.split("\t");
    return {
      course: parts[0], branch: parts[1], sem: parts[2], subject: parts[3],
      year: parts[4], month: parts[5], paperUrl: parts[6], pdfUrl: parts[7],
      targetPath: parts[8],
    };
  });
}

async function fileExistsNonEmpty(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile() && s.size > 0;
  } catch { return false; }
}

async function downloadOne(entry: Entry): Promise<{ ok: boolean; reason?: string }> {
  if (await fileExistsNonEmpty(entry.targetPath)) {
    return { ok: true, reason: "skipped" };
  }
  await mkdir(dirname(entry.targetPath), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(entry.pdfUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) {
        if (r.status === 404) return { ok: false, reason: "404" };
        throw new Error(`HTTP ${r.status}`);
      }
      const ct = r.headers.get("content-type") || "";
      const buf = await r.arrayBuffer();
      if (buf.byteLength === 0) throw new Error("empty body");
      // Sanity check: should be a PDF (or at least not HTML error page)
      if (ct.includes("text/html")) {
        return { ok: false, reason: "html-not-pdf" };
      }
      await writeFile(entry.targetPath, new Uint8Array(buf));
      return { ok: true };
    } catch (e: any) {
      if (attempt === 2) {
        return { ok: false, reason: e.message || "error" };
      }
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return { ok: false, reason: "exhausted-retries" };
}

async function main() {
  const all = await loadManifest();
  const entries = filter ? all.filter(e => e.course.toLowerCase().includes(filter.toLowerCase())) : all;
  process.stderr.write(`Total entries: ${all.length}\n`);
  process.stderr.write(`Filtered: ${entries.length}${filter ? ` (filter="${filter}")` : ""}\n`);

  let done = 0, ok = 0, skipped = 0, failed = 0;
  const total = entries.length;
  const startTime = Date.now();
  await writeFile(LOG_FAIL, ""); // reset
  await writeFile(PROGRESS, `Started: ${new Date().toISOString()}\nTotal: ${total}\n`);

  // Worker pool
  let cursor = 0;
  async function worker() {
    while (cursor < entries.length) {
      const i = cursor++;
      const e = entries[i];
      const r = await downloadOne(e);
      done++;
      if (r.ok) {
        if (r.reason === "skipped") skipped++; else ok++;
      } else {
        failed++;
        await appendFile(LOG_FAIL, `${r.reason}\t${e.pdfUrl}\t${e.targetPath}\n`);
      }
      if (done % 50 === 0 || done === total) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = done / elapsed;
        const eta = (total - done) / rate;
        const msg = `[${done}/${total}] ok=${ok} skip=${skipped} fail=${failed} rate=${rate.toFixed(1)}/s eta=${Math.round(eta)}s`;
        process.stderr.write(msg + "\n");
        await appendFile(PROGRESS, msg + "\n");
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const elapsed = (Date.now() - startTime) / 1000;
  const summary = `\nDONE: total=${total} ok=${ok} skipped=${skipped} failed=${failed} elapsed=${elapsed.toFixed(0)}s\n`;
  process.stderr.write(summary);
  await appendFile(PROGRESS, summary);
}

main().catch(e => { console.error(e); process.exit(1); });
