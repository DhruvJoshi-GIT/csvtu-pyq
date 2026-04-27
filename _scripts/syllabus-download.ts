// Download syllabus/scheme PDFs from csvtu.ac.in/ew/programs-and-schemes/
// and organize them into public/syllabus/ by program type.

import { mkdir, writeFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

const ROOT = "D:/CLaude/PYQ";
const OUT_BASE = `${ROOT}/public/syllabus`;
const SOURCE_PAGE = "https://csvtu.ac.in/ew/programs-and-schemes/";
const SOURCE_BASE = "https://csvtu.ac.in/ew/";

type Entry = { sourceUrl: string; targetPath: string; program: string; label: string };

function resolveUrl(href: string): string {
  // Decode HTML entities (e.g. &amp;)
  const decoded = href
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
  // Resolve against the page URL (so "../" goes up one directory from the page's path)
  return new URL(decoded, SOURCE_PAGE).href;
}

// Categorize a PDF URL into a top-level program folder
function categorize(url: string): { program: string; label: string } | null {
  // Get URL path components
  const u = new URL(url);
  const pathSegs = decodeURIComponent(u.pathname).split("/").filter(Boolean);
  // Look at path structure: /ew/programs/<category>/...optional.../file.pdf
  const idx = pathSegs.indexOf("programs");
  if (idx < 0 || idx >= pathSegs.length - 1) return null;
  const category = pathSegs[idx + 1].toLowerCase();
  const filename = pathSegs[pathSegs.length - 1];

  // Normalize category names → top-level program folder
  const map: Record<string, string> = {
    "b,tech scheme new": "BTech",
    "btech-scheme": "BTech",
    "be-schemes": "BTech",
    "b-arch-scheme": "BArchitecture",
    "b-pharma-scheme": "BPharmacy",
    "bac-voc-scheme": "BVocational",
    "bba": "BBA",
    "bca-scheme": "BCA",
    "diploma engineering new": "Diploma",
    "diploma scheme new": "Diploma",
    "diploma-schemes": "Diploma",
    "diploma-scheme-2019-20": "Diploma",
    "dip-voc-scheme": "DVocational",
    "dpharma": "DPharmacy",
    "d-pharma": "DPharmacy",
    "d-vocational": "DVocational",
    "mba-scheme": "MBA",
    "mca-scheme": "MCA",
    "m-pharma": "MPharmacy",
    "m-pharma-scheme": "MPharmacy",
    "m-pharma-schemes": "MPharmacy",
    "mtech-schemes": "MTech",
    "mtech": "MTech",
    "phd": "PhD",
    "ptdc": "PTDC",
    "scheme": "Other",
  };
  const program = map[category] || category.replace(/[^a-z0-9-]/g, "-").replace(/^-|-$/g, "");

  // Build label from filename (strip extension, clean up)
  let label = filename.replace(/\.pdf$/i, "");
  label = label.replace(/_/g, " ").replace(/\s+/g, " ").trim();

  return { program, label };
}

async function fetchHtml(url: string): Promise<string> {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; PYQBot/1.0)" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.text();
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile() && s.size > 0;
  } catch { return false; }
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

async function downloadPdf(entry: Entry): Promise<{ ok: boolean; reason?: string }> {
  if (await fileExists(entry.targetPath)) {
    return { ok: true, reason: "skipped" };
  }
  await mkdir(dirname(entry.targetPath), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(entry.sourceUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; PYQBot/1.0)" },
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) {
        if (r.status === 404) return { ok: false, reason: "404" };
        throw new Error(`HTTP ${r.status}`);
      }
      const buf = await r.arrayBuffer();
      if (buf.byteLength === 0) throw new Error("empty body");
      const ct = r.headers.get("content-type") || "";
      if (ct.includes("text/html")) return { ok: false, reason: "html-not-pdf" };
      await writeFile(entry.targetPath, new Uint8Array(buf));
      return { ok: true };
    } catch (e: any) {
      if (attempt === 2) return { ok: false, reason: e.message || "error" };
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return { ok: false, reason: "exhausted-retries" };
}

async function main() {
  process.stderr.write(`Fetching ${SOURCE_PAGE}...\n`);
  const html = await fetchHtml(SOURCE_PAGE);

  // Extract all .pdf hrefs
  const matches = [...html.matchAll(/href="([^"]+\.pdf)"/gi)];
  const seen = new Set<string>();
  const entries: Entry[] = [];

  for (const m of matches) {
    const url = resolveUrl(m[1]);
    if (seen.has(url)) continue;
    seen.add(url);
    // Skip non-program PDFs (notices, university acts)
    if (!url.includes("/programs/")) continue;

    const cat = categorize(url);
    if (!cat) continue;

    const filename = decodeURIComponent(url.split("/").pop()!);
    const safeName = sanitizeFilename(filename);
    const targetPath = `${OUT_BASE}/${cat.program}/${safeName}`;

    entries.push({
      sourceUrl: url,
      targetPath,
      program: cat.program,
      label: cat.label,
    });
  }

  process.stderr.write(`Found ${entries.length} program PDFs across ${new Set(entries.map(e => e.program)).size} categories.\n`);

  // Group preview
  const byProgram = new Map<string, number>();
  for (const e of entries) byProgram.set(e.program, (byProgram.get(e.program) || 0) + 1);
  for (const [p, n] of byProgram) {
    process.stderr.write(`  ${p}: ${n} PDFs\n`);
  }

  // Download with concurrency
  const CONCURRENCY = 8;
  let done = 0, ok = 0, skipped = 0, failed = 0;
  const failures: Array<{ url: string; reason: string }> = [];
  const startTime = Date.now();
  let cursor = 0;

  async function worker() {
    while (cursor < entries.length) {
      const i = cursor++;
      const e = entries[i];
      const r = await downloadPdf(e);
      done++;
      if (r.ok) {
        if (r.reason === "skipped") skipped++; else ok++;
      } else {
        failed++;
        failures.push({ url: e.sourceUrl, reason: r.reason || "?" });
      }
      if (done % 20 === 0 || done === entries.length) {
        const elapsed = (Date.now() - startTime) / 1000;
        process.stderr.write(`[${done}/${entries.length}] ok=${ok} skip=${skipped} fail=${failed} (${elapsed.toFixed(0)}s)\n`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  process.stderr.write(`\nDONE: total=${entries.length} ok=${ok} skipped=${skipped} failed=${failed}\n`);
  if (failures.length > 0) {
    process.stderr.write("Failures:\n");
    for (const f of failures) process.stderr.write(`  ${f.reason}\t${f.url}\n`);
  }

  // Write a manifest of syllabus entries for the site
  const syllabusManifest = entries
    .filter(e => true) // include all (failures will be handled by file-existence check at site build)
    .map(e => ({
      program: e.program,
      label: e.label,
      filename: e.targetPath.split(/[\\/]/).pop()!,
      path: `/syllabus/${e.program}/${e.targetPath.split(/[\\/]/).pop()!}`,
      sourceUrl: e.sourceUrl,
    }));
  await mkdir(`${ROOT}/_scripts`, { recursive: true });
  await writeFile(
    `${ROOT}/_scripts/syllabus-manifest.json`,
    JSON.stringify(syllabusManifest, null, 2)
  );
  process.stderr.write(`Wrote _scripts/syllabus-manifest.json with ${syllabusManifest.length} entries\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
