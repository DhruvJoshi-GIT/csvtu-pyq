// Subject-level fuzzy search for CSVTU PYQ.
// Indexes unique subjects (1.5K entries, not 5K papers) so results are
// focused. Pre-processes the query to expand aliases and isolate year
// tokens so students can search casually like "math 3rd sem 2019".

import Fuse from 'fuse.js';

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

type SyllabusEntry = {
  id: string;
  program: string;
  label: string;
  filename: string;
  path: string;
  bytes: number;
};

type Manifest = {
  subjects: SubjectIndex[];
  syllabus: SyllabusEntry[];
};

// ─────────── Alias maps ───────────
const branchAliases: Record<string, string> = {
  cs: 'CSE computer science',
  cse: 'CSE computer science',
  it: 'IT information technology',
  ec: 'ET electronics',
  ece: 'ET electronics communication',
  etc: 'ET electronics telecommunication',
  electronics: 'ET',
  telecom: 'ET',
  mech: 'ME mechanical',
  mechanical: 'ME mechanical',
  civil: 'CE civil',
  ee: 'EE electrical',
  electrical: 'EE electrical',
  eee: 'EEE electrical electronics',
  ei: 'EI instrumentation',
  instrumentation: 'EI instrumentation',
  bt: 'BT biotech',
  biotech: 'BT biotechnology',
  biotechnology: 'BT biotechnology',
  mi: 'MI mining',
  mining: 'MI mining',
  metallurgy: 'MT metallurgy',
};

const subjectAliases: Record<string, string> = {
  dbms: 'database management',
  database: 'database',
  os: 'operating system',
  ds: 'data structure',
  daa: 'design analysis algorithm',
  toc: 'theory of computation',
  se: 'software engineering',
  ml: 'machine learning',
  ai: 'artificial intelligence',
  dl: 'deep learning',
  nlp: 'natural language',
  cn: 'computer network',
  coa: 'computer organization architecture',
  ooad: 'object oriented analysis design',
  oop: 'object oriented programming',
  oops: 'object oriented programming',
  cd: 'compiler design',
  ca: 'computer architecture',
  dsp: 'digital signal processing',
  edc: 'electronic device circuit',
  crypto: 'cryptography',
  math: 'mathematics',
  maths: 'mathematics',
  phys: 'physics',
  chem: 'chemistry',
  thermo: 'thermodynamics',
  fm: 'fluid mechanics',
  som: 'strength materials',
  tom: 'theory machines',
  hmt: 'heat mass transfer',
  pe: 'power electronics',
  ps: 'power system',
  vlsi: 'vlsi',
  algo: 'algorithm',
  prob: 'probability statistics',
  stats: 'statistics',
  la: 'linear algebra',
};

// Extract year tokens from query, return cleaned query + years
function extractYears(q: string): { cleaned: string; years: string[] } {
  const years: string[] = [];
  const cleaned = q.replace(/\b(19|20)\d{2}\b/g, m => {
    years.push(m);
    return ' ';
  });
  return { cleaned: cleaned.replace(/\s+/g, ' ').trim(), years };
}

function normalizeQuery(q: string): string {
  let s = q.toLowerCase().trim();

  // Sem normalization
  s = s.replace(/\b(first|1st|fy)\s*(year|yr)\b/g, '1st-year');
  s = s.replace(/\b(second|2nd|sy)\s*(year|yr)\b/g, '2nd-year');
  s = s.replace(/\b(third|3rd|ty)\s*(year|yr)\b/g, '3rd-year');
  s = s.replace(/\b(fourth|4th|final)\s*(year|yr)\b/g, '4th-year');
  s = s.replace(/\b(?:sem(?:ester)?\s*[-]?\s*)(\d)\b/g, 'sem-$1');
  s = s.replace(/\b(\d)(?:st|nd|rd|th)?\s*sem(?:ester)?\b/g, 'sem-$1');

  // 2-digit year hint (e.g. "19" → "2019") — only when standalone
  s = s.replace(/\b(\d{2})\b(?!\d)/g, (m, d) => {
    const n = parseInt(d, 10);
    if (n >= 0 && n <= 30) return `20${d.padStart(2, '0')}`;
    if (n >= 80 && n <= 99) return `19${d}`;
    return m;
  });

  // Expand aliases (whole-word)
  const tokens = s.split(/\s+/);
  const expanded: string[] = [];
  for (const t of tokens) {
    if (branchAliases[t]) expanded.push(branchAliases[t]);
    else if (subjectAliases[t]) expanded.push(subjectAliases[t]);
    else expanded.push(t);
  }
  return expanded.join(' ');
}

// ─────────── Fuse setup ───────────
let fuseSubjects: Fuse<SubjectIndex> | null = null;
let fuseSyllabus: Fuse<SyllabusEntry> | null = null;
let manifest: Manifest | null = null;
let loadingPromise: Promise<void> | null = null;

async function ensureLoaded(baseUrl: string): Promise<void> {
  if (manifest) return;
  if (!loadingPromise) {
    loadingPromise = (async () => {
      const res = await fetch(`${baseUrl}/manifest.json`);
      if (!res.ok) throw new Error(`manifest fetch failed: ${res.status}`);
      const data = await res.json();
      // Index subjects with friendly searchable text
      // We replace dashes with spaces so "mathematics-3" matches "math 3"
      const enrichedSubjects = data.subjects.map((s: SubjectIndex) => ({
        ...s,
        searchName: s.name.replace(/-/g, ' '),
        searchTopic: s.topic.replace(/-/g, ' '),
      }));
      fuseSubjects = new Fuse(enrichedSubjects, {
        keys: [
          { name: 'searchName', weight: 0.6 },
          { name: 'searchTopic', weight: 0.15 },
          { name: 'course', weight: 0.10 },
          { name: 'branch', weight: 0.10 },
          { name: 'sem', weight: 0.05 },
        ],
        threshold: 0.4,
        distance: 200,
        ignoreLocation: true,
        minMatchCharLength: 2,
        includeScore: true,
      });
      fuseSyllabus = new Fuse(data.syllabus.map((s: SyllabusEntry) => ({
        ...s,
        searchLabel: s.label.replace(/[-_]+/g, ' '),
      })), {
        keys: [
          { name: 'searchLabel', weight: 0.7 },
          { name: 'program', weight: 0.3 },
        ],
        threshold: 0.4,
        distance: 200,
        ignoreLocation: true,
        minMatchCharLength: 2,
      });
      // Only commit manifest after indexes are built — readers gate on `manifest`
      manifest = data;
    })().catch(err => {
      // Clear so next search retries instead of silently dying forever
      loadingPromise = null;
      throw err;
    });
  }
  await loadingPromise;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function formatSubjectMeta(s: SubjectIndex): string {
  const branchPart = s.branch === '_' ? '' : ` · ${s.branch}`;
  const semPart = ` · ${s.sem.replace('Sem-', 'Sem ').replace('1st-Year', '1st Year')}`;
  return `${s.course}${branchPart}${semPart}`;
}

export function initSearch(baseUrl: string) {
  const input = document.getElementById('search-input') as HTMLInputElement | null;
  const resultsEl = document.getElementById('search-results') as HTMLDivElement | null;
  if (!input || !resultsEl) return;

  let debounce: any;
  // Sequence guard: only the latest run is allowed to write to the DOM.
  // Without this, a slow first run can finish AFTER a faster later run and
  // overwrite fresh results with stale ones — which looks like "search broke
  // after the first query".
  let runSeq = 0;

  async function run(rawQuery: string) {
    const mySeq = ++runSeq;
    const q = rawQuery.trim();

    if (q.length < 2) {
      resultsEl!.innerHTML = '';
      return;
    }

    if (!manifest) {
      resultsEl!.innerHTML = '<div class="empty">Loading subject index…</div>';
    }
    try {
      await ensureLoaded(baseUrl);
    } catch {
      if (mySeq === runSeq) {
        resultsEl!.innerHTML = '<div class="empty">Couldn&rsquo;t load search index. Check your connection and try again.</div>';
      }
      return;
    }
    // A newer run started while we were awaiting — bail before writing.
    if (mySeq !== runSeq) return;

    const { cleaned, years } = extractYears(q);
    const normalized = normalizeQuery(cleaned);
    const tokens = normalized.split(/\s+/).filter(t => t.length >= 2);

    let html = '';

    if (tokens.length > 0) {
      const pattern = tokens.join(' ');
      const subjResults = fuseSubjects!.search(pattern, { limit: 60 });
      const filtered = years.length > 0
        ? subjResults.filter(r => years.some(y => r.item.years.includes(y)))
        : subjResults;
      const top = filtered.slice(0, 25);

      if (top.length > 0) {
        html += '<div class="search__group-label">Subjects</div>';
        html += top.map(r => {
          const s = r.item;
          const href = years.length > 0
            ? `${baseUrl}${s.href}#year-${years[0]}`
            : `${baseUrl}${s.href}`;
          const yrText = years.length > 0
            ? years.filter(y => s.years.includes(y)).map(y => `<span class="search__year">${y}</span>`).join('')
            : `${s.years.length} year${s.years.length === 1 ? '' : 's'}`;
          return `<a class="search__hit" href="${href}">
            <div style="flex: 1; min-width: 0;">
              <div class="search__hit-name">${escapeHtml(s.name.replace(/-/g, ' '))}</div>
              <div class="search__hit-meta">${escapeHtml(formatSubjectMeta(s))} · ${s.paperCount} paper${s.paperCount === 1 ? '' : 's'}</div>
            </div>
            <div class="search__hit-right">${yrText}</div>
          </a>`;
        }).join('');
      }

      const sylResults = fuseSyllabus!.search(pattern, { limit: 6 });
      if (sylResults.length > 0) {
        html += '<div class="search__group-label">Syllabus</div>';
        html += sylResults.map(r => {
          const e = r.item;
          return `<a class="search__hit" href="${baseUrl}${e.path}" target="_blank" rel="noopener">
            <div style="flex: 1; min-width: 0;">
              <div class="search__hit-name">${escapeHtml(e.label)}</div>
              <div class="search__hit-meta">${escapeHtml(e.program)} syllabus · PDF</div>
            </div>
            <span class="search__chip search__chip--syllabus">Syllabus</span>
          </a>`;
        }).join('');
      }
    }

    if (mySeq !== runSeq) return;

    if (!html) {
      resultsEl!.innerHTML = '<div class="empty">No matches. Try a subject name like &ldquo;mathematics&rdquo; or &ldquo;dbms&rdquo;.</div>';
    } else {
      resultsEl!.innerHTML = html;
    }

    // Mobile: virtual keyboard covers the bottom half. Pull the input to the
    // top so the results below it are visible above the keyboard.
    if (window.matchMedia('(max-width: 768px)').matches) {
      input!.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }

  const schedule = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => run(input.value), 120);
  };
  // `input` covers typing on every platform; `change` and `search` are
  // belt-and-suspenders for mobile keyboards that batch input events
  // (some Android IMEs only fire `input` on word commit).
  input.addEventListener('input', schedule);
  input.addEventListener('change', schedule);
  input.addEventListener('search', schedule);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = resultsEl!.querySelector('a.search__hit') as HTMLAnchorElement | null;
      if (first) {
        e.preventDefault();
        first.click();
      }
    }
  });
}
