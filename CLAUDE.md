# CLAUDE.md — context for future sessions

Notes for Claude Code working in this repo. Skim this before doing anything; it captures non-obvious knowledge accumulated over earlier sessions and CSVTU domain quirks that aren't in `README.md`.

## What this is

Static Astro 5 site hosting CSVTU's previous-year question papers (~3000 BTech papers + Diploma/MTech/MBA/MCA/BCA/Pharmacy + curriculum schemes + syllabus links). Bun for tooling, Fuse.js for client-side fuzzy search, no backend, deploys to GitHub Pages on push to `main`.

- Origin: `github.com/DhruvJoshi-GIT/csvtu-pyq`
- Live: `https://dhruvjoshi-git.github.io/csvtu-pyq/`
- Working dir on this machine: `D:\CLaude\PYQ`

## Standing instruction (from the user)

**Commit and push every completed change without asking.** Pushing IS the deploy (GitHub Actions builds and publishes to Pages on push to `main`). Group related edits into one commit; split unrelated edits. Don't bypass hooks. This applies only to this repo.

## Layout & data flow

```
public/papers/<Course>/<Branch>/<Sem>/[<Topic>/]<Subject>/<Year>/<file>.pdf
                                       └─ optional, capital-cased dirs are topic groupings
public/schemes/<Program>/<file>.pdf       — downloaded scheme PDFs
public/syllabus/                          — referenced via catalog only

scripts/build-manifest.ts   walks public/papers/ + applies subject-aliases.ts
                            → src/data/manifest.json + public/manifest.json
scripts/subject-aliases.ts  pin a subject into additional sem slots (see below)
src/data/catalog.json       schemes + syllabus URLs (built separately)
src/data/course-info.ts     course/branch full names (Bachelor of … etc.)
src/pages/c/[...slug].astro one route handles course/branch/sem/subject views
src/pages/index.astro       home + global search
src/pages/schemes/          curriculum schemes section
src/pages/syllabus/         syllabus links section
src/scripts/search.ts       client-side fuzzy search (Fuse.js, manifest.json)
```

`Branch === '_'` is the no-branch placeholder used for courses like MBA / MCA / BCA / BPharmacy where there's no branch layer — sems get promoted to course-top-level. Don't break this.

## Build commands

```bash
bun install
bun run manifest   # regenerate manifest only (fast, ~2s)
bun run build      # manifest + astro build → dist/
bun run dev        # local dev server
```

`build` writes 1700+ static pages. ~16-20s on this machine. Always re-run after touching the build script or any `public/papers/` content.

## CSVTU subject-code semantics (critical — drives several features)

CSVTU encodes the program/branch/sem inside subject codes. The build script relies on this to detect both **degree (BE vs BTech)** and **branch**.

Old BE scheme — 6-digit numeric `[3][BB][S][SS]`:
- `3` = BE/BTech program level
- `BB` = branch (`22`=CSE, `24`=EE, `25`=EEE, `28`=ET, `37`=ME, `00`=common/1st-year)
- `S` = semester digit
- `SS` = serial

Diploma old scheme: same shape but starts with `2` (e.g. `237613`).

New BTech scheme (post-~2019/2020 transition) — `[c0|d0][BB][S][SS]`:
- `c0…` and `d0…` are different scheme generations; both are BTech-era
- Same `BB` `S` `SS` semantics

Filename prefix hints (less reliable than codes — these were added by whoever scanned the PDFs):
- `be-` → BE-era
- `btech-` → BTech-era
- `eee-` / `ee-` / `et-` → branch hint

**Trust the code over the prefix when they disagree.** The codes are CSVTU's official identifiers.

## Build-time classification (already implemented)

Two functions in `scripts/build-manifest.ts`:

- **`detectDegree(filename, course)`** → `'BE' | 'BTech' | undefined`. Used to tag each paper and aggregate per-subject `era` summaries (BE / BTech / mixed). UI renders chips and banners on subject pages.
- **`detectBranch(filename, course, folderBranch)`** → re-routes BTech papers to their real branch when the `EE` folder contains EEE-coded or ET-coded papers. Override is scoped to `{EE, EEE, ET}` only — don't expand without auditing other branches. Files stay on disk; only the browse hierarchy changes.

If you add more branch mappings (e.g. CSE/IT confusion), follow the same pattern and add to `BRANCH_DIGIT_MAP` + `ROUTE_BRANCHES`.

## Subject aliases — `scripts/subject-aliases.ts`

A subject can be "pinned" into additional sem slots so students who look in the wrong sem still find it. The PDFs stay in their canonical folder; the alias entry has an `aliasOf` field that the subject page uses to look up papers from the source location.

Example currently in use: BTech ME `power-plant-engineering` is canonically Sem-6 but also surfaces under Sem-8 because students kept asking for it there.

When adding aliases:
- `also_in` entries default to source's course/branch unless overridden, so most aliases are one line.
- The alias subject page generates as a separate URL but renders the same papers. Both URLs work.

## Search — `src/scripts/search.ts`

Indexes only subjects (~1500 entries) not papers (~5000), so results are focused. Pre-processes the query to expand aliases (`dbms` → `database management`, `cs` → `CSE computer science`) and isolate year tokens (`math 3rd sem 2019` → search for "math sem-3" filtered to year 2019).

Quirks worth remembering:
- Race-condition guard via `runSeq` counter — only the latest run writes to the DOM. Don't reintroduce a `lastQuery` dedupe ahead of the await; that broke search after one query.
- On `loadingPromise` failure, it resets to `null` so next keystroke retries. Don't remove this — silent dies are very hard to debug from a static site.
- On viewports `<= 768px`, scrolls input to top of viewport on result render so the list isn't behind the mobile keyboard.

## CSVTU domain quirks (saves Googling)

- **EE ≠ EEE.** They are *separate* BTech programs at CSVTU. Electrical Engineering (`24`-codes) vs Electrical & Electronics Engineering (`25`-codes). Old archive folder `BTech/EE/` was a mash-up — split is now done at build time via `detectBranch()`.
- **BE → BTech transition** happened ~2019-2020. Subject codes changed from `3XXXXX` to `c0…` / `d0…`. Subjects shifted between sems and some were renamed/dropped. ~10% of "BTech" papers in the archive are actually BE-era.
- **Power Plant Engineering** at BTech is Sem 6, *not* Sem 8 (despite student requests). It's a Mechanical subject, not its own branch. CSVTU has no "Power Plant Engineering" undergrad branch. MTech offers it as a Sem-3 subject in the Thermal stream.
- **Schemes vs syllabus.** CSVTU publishes "schemes" (curriculum PDFs listing subjects per sem with credit hours) separately from "syllabus" (per-subject content pages). Both linked from `csvtu.ac.in/ew/programs-and-schemes/`. The site's `/schemes/` and `/syllabus/` sections expose them; tracked in `src/data/catalog.json`.

## Known content gaps (not code bugs — papers just haven't been collected)

- **BTech EE Sem-8: latest year is 2023.** Sem-7 has 2024 papers but Sem-8 doesn't. Pure scraping/collection gap.
- **Diploma EEE is sparse** — 10 papers across Sem-3/4/6 only, no Sem-7/8.
- **Folder typos that fragment subjects** (worth a one-time cleanup pass with `git mv`):
  - `BTech/ME/Sem-8/automobil-engineering` + `autonobile-engineering` → both should be `automobile-engineering` (already exists in Sem-6/7 with correct spelling)
  - `BTech/EE/Sem-8/` has 5 different misspellings of "installation-maintenance-and-testing-of-electrical-equipments" that fragment the subject across 5 cards instead of 1

## Useful sanity checks

```bash
# Per-branch BTech paper counts
bun -e "const m=require('./src/data/manifest.json'); for(const b of m.tree.find(c=>c.name==='BTech').branches){let n=0;for(const s of b.sems)for(const sub of s.subjects)n+=sub.count;console.log(b.name+': '+n)}"

# Find papers by subject-code prefix (e.g. all 325XXX = EEE)
find public/papers -name "*325[0-9][0-9][0-9]*.pdf" | head

# Check what era chips a sem listing renders
grep -oE 'era era--[a-z]+' dist/c/BTech/CSE/Sem-8/index.html | sort | uniq -c
```

## What was done in recent sessions (so you don't redo it)

- `3136e7b` Search race condition + mobile keyboard occlusion fix
- `781b0b2` Subject-alias system — Power Plant Engineering also under Sem 8
- `dd9e020` BE-era vs BTech-era tagging, chips on sem listings + per-paper banners
- `8367b0d` EE → EE/EEE/ET split via subject-code detection (no file moves)

Each commit message has the rationale; `git show <sha>` for details.
