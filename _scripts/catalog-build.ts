// Re-scrape csvtu.ac.in/ew/programs-and-schemes/ to build a structured
// catalog of programs → sessions → courses, with both scheme PDF URLs
// and external syllabus page URLs, plus HTTP Last-Modified for each.

import { mkdir, writeFile, stat } from "node:fs/promises";
import { dirname } from "node:path";

const SOURCE_PAGE = "https://csvtu.ac.in/ew/programs-and-schemes/";
const ROOT = "D:/CLaude/PYQ";
const SCHEMES_OUT = `${ROOT}/public/schemes`;
const CATALOG_OUT = `${ROOT}/src/data/catalog.json`;

type CatalogEntry = {
  program: string;            // BTech, MTech, Diploma, ... (top-level program)
  programLabel: string;       // pretty label
  session: string;            // "2025-26" / "2019-20" / "Legacy" / ""
  course: string;             // course name within program
  courseSlug: string;         // for URLs
  schemeUrl: string | null;   // source PDF URL
  schemeLocalPath: string | null; // /schemes/<program>/<file>.pdf if downloaded
  schemeLastModified: string | null;
  schemeBytes: number | null;
  syllabusUrl: string | null; // external URL to CSVTU syllabus page
  syllabusLastModified: string | null;
};

// ─────────── Section/program inference ───────────
// Sections in the source page have headings like "Bachelor of Technology (B.Tech.) - Session 2025-26".
// Map a heading to (program, session).
function inferSectionMeta(heading: string): { program: string; session: string } {
  const h = heading.toLowerCase();
  let session = "";
  // Extract session year e.g. "2025-26", "2019-20"
  const m = heading.match(/\b(20\d{2})\s*[-–—]\s*(\d{2}|20\d{2})\b/);
  if (m) session = `${m[1]}-${m[2].length === 4 ? m[2].slice(2) : m[2]}`;
  else if (/legacy|nitttr/i.test(heading)) session = "Legacy";

  if (/bachelor of technology|b\.tech/i.test(heading)) return { program: "BTech", session };
  if (/bachelor of engineering|^be(\b|\s)/i.test(heading)) return { program: "BE", session: session || "Legacy" };
  if (/master of technology|m\.\s*tech/i.test(heading)) return { program: "MTech", session };
  if (/master of business|^mba/i.test(heading)) return { program: "MBA", session };
  if (/master of computer applications|^mca/i.test(heading)) return { program: "MCA", session };
  if (/bachelor of business|^bba/i.test(heading)) return { program: "BBA", session };
  if (/bachelor of pharmacy|^b\.\s*pharm/i.test(heading)) return { program: "BPharmacy", session };
  if (/master of pharmacy|^m\.\s*pharm/i.test(heading)) return { program: "MPharmacy", session };
  if (/diploma in pharmacy|^d\.\s*pharm/i.test(heading)) return { program: "DPharmacy", session };
  if (/bachelor of architecture|^b\.\s*arch/i.test(heading)) return { program: "BArchitecture", session };
  if (/bachelor of computer applications|^bca/i.test(heading)) return { program: "BCA", session };
  if (/bachelor of vocation|^b\.\s*voc/i.test(heading)) return { program: "BVocational", session };
  if (/diploma of vocation|^d\.\s*voc/i.test(heading)) return { program: "DVocational", session };
  if (/diploma in engineering|polytechnic/i.test(heading)) return { program: "Diploma", session };
  if (/part time|^ptdc/i.test(heading)) return { program: "PTDC", session };
  if (/phd|ph\.\s*d/i.test(heading)) return { program: "PhD", session };
  return { program: "Other", session };
}

function slugify(s: string): string {
  return s.toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?38;/g, "&")
    .replace(/&#x26;/g, "&")
    .trim();
}

function resolveUrl(href: string): string {
  return new URL(decodeEntities(href), SOURCE_PAGE).href;
}

// ─────────── HTML parsing ───────────
async function fetchHtml(url: string): Promise<string> {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.text();
}

// Walk the page DOM-ish: find each section-header div and the table that follows.
function parsePage(html: string): CatalogEntry[] {
  const entries: CatalogEntry[] = [];

  // CSVTU page structure: each section is wrapped in
  //   <div class="syllabus-box">
  //     <div class="syllabus-header"><a id="...">Section name</a></div>
  //     <div class="syllabus-content"><table>...</table></div>
  //   </div>
  // So walk those markers and capture the section name.
  const headerRe = /<div\s+class="syllabus-header"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/gi;
  const headings: Array<{ idx: number; text: string }> = [];
  let hm: RegExpExecArray | null;
  while ((hm = headerRe.exec(html)) !== null) {
    const text = decodeEntities(hm[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    if (!text || text.length < 5) continue;
    headings.push({ idx: hm.index, text });
  }
  headings.sort((a, b) => a.idx - b.idx);
  process.stderr.write(`Found ${headings.length} section headers.\n`);

  // Find each <tr>...</tr> with three <td> cells (course, scheme, syllabus)
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trm: RegExpExecArray | null;
  while ((trm = trRe.exec(html)) !== null) {
    const trIdx = trm.index;
    const trBody = trm[1];
    const tds = [...trBody.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1]);
    if (tds.length < 2) continue;

    // Extract course name (plain text from first td)
    const course = decodeEntities(tds[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    if (!course || course.length < 3) continue;
    if (/scheme|syllabus/i.test(course) && course.length < 12) continue; // header row

    // Extract first PDF link (scheme) and first non-PDF link (syllabus)
    const pdfMatch = trBody.match(/href="([^"]+\.pdf)"/i);
    const syllabusMatch = [...trBody.matchAll(/href="([^"]+)"/gi)]
      .map(m => m[1])
      .filter(u => !/\.pdf$/i.test(u))
      .find(u => /\/[a-z]/i.test(u));

    const schemeUrl = pdfMatch ? resolveUrl(pdfMatch[1]) : null;
    const syllabusUrl = syllabusMatch ? resolveUrl(syllabusMatch) : null;
    if (!schemeUrl && !syllabusUrl) continue;

    // Find the most recent heading before this row
    let lastHeading = "";
    for (const h of headings) {
      if (h.idx < trIdx) lastHeading = h.text;
      else break;
    }
    const meta = inferSectionMeta(lastHeading);

    entries.push({
      program: meta.program,
      programLabel: meta.program,
      session: meta.session,
      course,
      courseSlug: slugify(course),
      schemeUrl,
      schemeLocalPath: null,
      schemeLastModified: null,
      schemeBytes: null,
      syllabusUrl,
      syllabusLastModified: null,
    });
  }

  return entries;
}

// ─────────── Last-Modified probe + scheme download ───────────
async function probeLastModified(url: string): Promise<{ lastMod: string | null; bytes: number | null }> {
  try {
    const r = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return { lastMod: null, bytes: null };
    const lm = r.headers.get("last-modified");
    const cl = r.headers.get("content-length");
    return { lastMod: lm, bytes: cl ? parseInt(cl, 10) : null };
  } catch {
    return { lastMod: null, bytes: null };
  }
}

async function downloadPdf(url: string, target: string): Promise<{ ok: boolean; lastMod: string | null; bytes: number | null }> {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) return { ok: false, lastMod: null, bytes: null };
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("text/html")) return { ok: false, lastMod: null, bytes: null };
    const buf = await r.arrayBuffer();
    if (buf.byteLength === 0) return { ok: false, lastMod: null, bytes: null };
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, new Uint8Array(buf));
    return {
      ok: true,
      lastMod: r.headers.get("last-modified"),
      bytes: buf.byteLength,
    };
  } catch {
    return { ok: false, lastMod: null, bytes: null };
  }
}

async function fileExistsNonEmpty(path: string): Promise<boolean> {
  try { const s = await stat(path); return s.isFile() && s.size > 0; } catch { return false; }
}

// ─────────── Main ───────────
async function main() {
  process.stderr.write(`Fetching ${SOURCE_PAGE}\n`);
  const html = await fetchHtml(SOURCE_PAGE);
  let entries = parsePage(html);
  process.stderr.write(`Parsed ${entries.length} entries.\n`);

  // Deduplicate by program + course (some duplicates from messy HTML)
  const seen = new Set<string>();
  entries = entries.filter(e => {
    const k = `${e.program}|${e.session}|${e.course}|${e.schemeUrl}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  process.stderr.write(`After dedup: ${entries.length} entries.\n`);

  // Stats
  const byProgram = new Map<string, number>();
  for (const e of entries) byProgram.set(e.program, (byProgram.get(e.program) || 0) + 1);
  for (const [p, n] of byProgram) process.stderr.write(`  ${p}: ${n}\n`);

  // Download all scheme PDFs + capture Last-Modified
  process.stderr.write(`\nDownloading schemes & probing Last-Modified...\n`);
  let done = 0, ok = 0, failed = 0;
  const startTime = Date.now();
  let cursor = 0;
  const CONCURRENCY = 8;

  // Group by program for cleaner folder layout
  async function worker() {
    while (cursor < entries.length) {
      const i = cursor++;
      const e = entries[i];
      if (e.schemeUrl) {
        const filename = decodeURIComponent(e.schemeUrl.split("/").pop()!).replace(/[<>:"/\\|?*]/g, "-");
        const localPath = `${SCHEMES_OUT}/${e.program}/${filename}`;
        const localUrl = `/schemes/${e.program}/${filename}`;
        if (await fileExistsNonEmpty(localPath)) {
          // Just probe for last-modified
          const probe = await probeLastModified(e.schemeUrl);
          e.schemeLastModified = probe.lastMod;
          e.schemeBytes = probe.bytes;
          e.schemeLocalPath = localUrl;
        } else {
          const r = await downloadPdf(e.schemeUrl, localPath);
          if (r.ok) {
            e.schemeLastModified = r.lastMod;
            e.schemeBytes = r.bytes;
            e.schemeLocalPath = localUrl;
            ok++;
          } else {
            failed++;
          }
        }
      }
      if (e.syllabusUrl) {
        const probe = await probeLastModified(e.syllabusUrl);
        e.syllabusLastModified = probe.lastMod;
      }
      done++;
      if (done % 25 === 0 || done === entries.length) {
        const t = ((Date.now() - startTime) / 1000).toFixed(0);
        process.stderr.write(`[${done}/${entries.length}] ok=${ok} fail=${failed} (${t}s)\n`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  process.stderr.write(`\nDone. Writing catalog...\n`);
  await mkdir(dirname(CATALOG_OUT), { recursive: true });
  await writeFile(CATALOG_OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    entries,
  }, null, 0));

  process.stderr.write(`Catalog: ${CATALOG_OUT} (${entries.length} entries)\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
