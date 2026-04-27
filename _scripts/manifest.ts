// Build manifest of all PDFs from csvtuonline.com
// Output: manifest.tsv with columns: course<TAB>branch<TAB>sem<TAB>subject<TAB>year<TAB>paper_url<TAB>pdf_url<TAB>target_path

import { mkdir, writeFile } from "node:fs/promises";

const BASE = "https://www.csvtuonline.com";
const ROOT = "D:/CLaude/PYQ";

type Source = {
  course: string;       // e.g. "BTech", "Diploma", "MBA"
  branch: string;       // e.g. "CSE", "IT", or "_" for single-branch courses
  url: string;          // full URL of category page
  flat?: boolean;       // true = no semester sections (rare)
};

const sources: Source[] = [
  // BTech branches (have semester sections)
  ...[
    ["cs", "CSE"], ["it", "IT"], ["me", "ME"], ["ce", "CE"],
    ["ee", "EE"], ["et", "ET"], ["bt", "BT"], ["ei", "EI"],
    ["mi", "MI"], ["mt", "MT"], ["others", "Others"],
  ].map(([slug, label]) => ({
    course: "BTech",
    branch: label,
    url: `${BASE}/btech-${slug}-question-papers.html`,
  })),

  // BTech 1st year shared
  { course: "BTech", branch: "1st-Year", url: `${BASE}/first-year-papers.html`, flat: true },

  // Diploma branches
  ...[
    ["ce", "CE"], ["cs", "CS"], ["ee", "EE"], ["eee", "EEE"],
    ["ei", "EI"], ["et", "ET"], ["ie", "IE"], ["it", "IT"],
    ["me", "ME"], ["met", "MET"], ["mi", "MI"], ["mom", "MOM"],
    ["mt", "MT"], ["others", "Others"],
  ].map(([slug, label]) => ({
    course: "Diploma",
    branch: label,
    url: `${BASE}/diploma-${slug}-question-papers.html`,
  })),

  // Single-page courses
  { course: "BCA", branch: "_", url: `${BASE}/bca.html` },
  { course: "BPharmacy", branch: "_", url: `${BASE}/bpharmacy.html` },
  { course: "DPharmacy", branch: "_", url: `${BASE}/dpharmacy.html` },
  { course: "MBA", branch: "_", url: `${BASE}/mba.html` },
  { course: "MCA", branch: "_", url: `${BASE}/mca.html` },
  { course: "MPharmacy", branch: "_", url: `${BASE}/mpharmacy.html` },
  { course: "MTech", branch: "_", url: `${BASE}/mtech.html` },
];

// Sanitize for filesystem
function sanitize(s: string): string {
  return s
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

// Extract semester from a paper slug
function extractSem(slug: string): string {
  // Newer format: btech-N-sem-... or btech-1-sem-2-sem-... (1st year combined)
  let m = slug.match(/btech-(\d+)-sem-(\d+)-sem/);
  if (m) return `Sem-${m[1]}-${m[2]}`;
  m = slug.match(/-(\d+)-sem-/);
  if (m) return `Sem-${m[1]}`;
  m = slug.match(/^(\d+)-sem-/);
  if (m) return `Sem-${m[1]}`;
  // Older 6-digit code: 322Xnn where X = semester
  m = slug.match(/(?:^|-)(\d{6})(?:-|$)/);
  if (m) {
    const code = m[1];
    const sem = code[3];
    if (/[1-8]/.test(sem)) return `Sem-${sem}`;
  }
  return "Unknown-Sem";
}

// Extract subject and exam date from slug
function parseSlug(slug: string): { subject: string; year: string; month: string } {
  // Strip extension
  let s = slug.replace(/\.html$/, "");
  // Find date suffix: -(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)-(YYYY) or just -(YYYY)
  let month = "unknown", year = "unknown";
  const fullMatch = s.match(/-(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)-(\d{4})$/i);
  if (fullMatch) {
    month = fullMatch[1].toLowerCase();
    year = fullMatch[2];
    s = s.slice(0, fullMatch.index!);
  } else {
    const yearOnly = s.match(/-(\d{4})$/);
    if (yearOnly && /^(19|20)\d{2}$/.test(yearOnly[1])) {
      year = yearOnly[1];
      s = s.slice(0, yearOnly.index!);
    }
  }

  // Strip subject code suffixes (various formats):
  // - 6-digit numeric: 322351
  // - letter+digits: a000113, b022313, c022611, d022711
  // - longer hybrids: 3000a02at014, 3025a01ct025
  s = s.replace(/-[a-z0-9]{5,15}$/i, m => {
    // Only strip if it contains digits (real codes always have digits)
    return /\d/.test(m) ? "" : m;
  });

  // Strip leading prefix tokens iteratively. Tokens to strip:
  // course names, branch codes, "N-sem", combined sem (1-sem-2-sem)
  const prefixTokens = new Set([
    "btech", "diploma", "bca", "mca", "mba", "mtech",
    "bpharmacy", "dpharmacy", "mpharmacy", "phd",
    "cs", "cse", "it", "me", "ce", "ee", "eee", "et", "ete",
    "bt", "ei", "mi", "mt", "ie", "met", "mom", "others",
    "pharmacy",
  ]);
  for (let i = 0; i < 8; i++) {
    // Strip "N-sem-"
    const semRe = /^(\d+)-sem-/;
    if (semRe.test(s)) { s = s.replace(semRe, ""); continue; }
    // Strip a known prefix token
    const tokenMatch = s.match(/^([a-z]+)-/i);
    if (tokenMatch && prefixTokens.has(tokenMatch[1].toLowerCase())) {
      s = s.slice(tokenMatch[0].length);
      continue;
    }
    // Strip leading numeric code (6-digit only at start)
    if (/^\d{6}-/.test(s)) { s = s.replace(/^\d{6}-/, ""); continue; }
    break;
  }

  return { subject: s.toLowerCase() || "unknown", year, month };
}

// Parse a category page HTML, return paper URLs grouped by section
function parsePage(html: string, source: Source): Array<{ section: string; url: string }> {
  const results: Array<{ section: string; url: string }> = [];
  if (source.flat) {
    // No semester sections — extract all paper links, semester from URL
    const matches = html.matchAll(/href="(https:\/\/www\.csvtuonline\.com\/papers\/[^"]+\.html)"/gi);
    for (const m of matches) {
      results.push({ section: "", url: m[1] });
    }
    return results;
  }
  // Branch pages with semester sections marked by <h3> ... N SEM PAPERS </h3>
  // Split HTML at semester markers
  const semRe = /<h3[^>]*>\s*([^<]*?\d+\s*SEM\s+PAPERS[^<]*?)<\/h3>/gi;
  const splits: Array<{ index: number; label: string }> = [];
  let m;
  while ((m = semRe.exec(html)) !== null) {
    splits.push({ index: m.index + m[0].length, label: m[1].trim() });
  }
  if (splits.length === 0) {
    // No sections, treat as flat
    const matches = html.matchAll(/href="(https:\/\/www\.csvtuonline\.com\/papers\/[^"]+\.html)"/gi);
    for (const m of matches) {
      results.push({ section: "", url: m[1] });
    }
    return results;
  }
  for (let i = 0; i < splits.length; i++) {
    const start = splits[i].index;
    const end = i + 1 < splits.length ? splits[i + 1].index : html.length;
    const chunk = html.slice(start, end);
    const semMatch = splits[i].label.match(/(\d+)\s*SEM/i);
    const sem = semMatch ? `Sem-${semMatch[1]}` : "Unknown-Sem";
    const linkRe = /href="(https:\/\/www\.csvtuonline\.com\/papers\/[^"]+\.html)"/gi;
    let lm;
    while ((lm = linkRe.exec(chunk)) !== null) {
      results.push({ section: sem, url: lm[1] });
    }
  }
  return results;
}

async function fetchWithRetry(url: string, tries = 3): Promise<string> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (r.ok) return await r.text();
    } catch (e) {}
    await new Promise(r => setTimeout(r, 500 * (i + 1)));
  }
  throw new Error(`Failed: ${url}`);
}

async function main() {
  const manifestPath = `${ROOT}/_scripts/manifest.tsv`;
  const lines: string[] = ["course\tbranch\tsem\tsubject\tyear\tmonth\tpaper_url\tpdf_url\ttarget_path"];
  const seen = new Set<string>();

  for (const src of sources) {
    process.stderr.write(`Fetching ${src.course}/${src.branch}...\n`);
    const html = await fetchWithRetry(src.url);
    const papers = parsePage(html, src);
    process.stderr.write(`  found ${papers.length} papers\n`);

    for (const p of papers) {
      if (seen.has(p.url)) continue;
      seen.add(p.url);

      const slug = p.url.split("/").pop()!.replace(/\.html$/, "");
      const sem = p.section || extractSem(slug);
      const { subject, year } = parseSlug(slug);
      const pdfUrl = p.url.replace(/\.html$/, ".pdf");

      // Build target path
      const branchSeg = src.branch === "_" ? "" : sanitize(src.branch);
      const subjectSeg = sanitize(subject || "unknown");
      const yearSeg = year !== "unknown" ? `/${year}` : "";

      let target: string;
      if (src.branch === "1st-Year") {
        // BTech\1st-Year\<Subject>\<Year>\<file>
        target = `${ROOT}/${src.course}/1st-Year/${subjectSeg}${yearSeg}/${slug}.pdf`;
      } else if (src.branch === "_") {
        // <Course>\<Sem>\<Subject>\<Year>\<file>
        target = `${ROOT}/${src.course}/${sem}/${subjectSeg}${yearSeg}/${slug}.pdf`;
      } else {
        // <Course>\<Branch>\<Sem>\<Subject>\<Year>\<file>
        target = `${ROOT}/${src.course}/${branchSeg}/${sem}/${subjectSeg}${yearSeg}/${slug}.pdf`;
      }

      lines.push([
        src.course, src.branch, sem, subject, year, "",
        p.url, pdfUrl, target
      ].join("\t"));
    }
  }

  await writeFile(manifestPath, lines.join("\n"));
  process.stderr.write(`\nManifest written: ${manifestPath}\nTotal entries: ${lines.length - 1}\n`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
