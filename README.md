# CSVTU PYQ

Previous-year question paper archive for **Chhattisgarh Swami Vivekanand Technical University** — every paper across BTech, Diploma, MBA, MCA, MTech, BCA, and Pharmacy courses, organized by course → branch → semester → topic → subject → year.

🌐 **Live site:** https://dhruvjoshi-git.github.io/csvtu-pyq/

## What's here

- **5,099 question papers** (PDFs)
- **9 courses** with full hierarchy
- Topic-grouped subjects (Mathematics, Physics, Chemistry, Computer-Networks, …) so finding similar subjects is one click
- Client-side search across all papers (course / branch / subject / year)
- Mobile-first dark UI, no tracking, no ads

## Local development

```bash
bun install
bun run build     # generates manifest + builds site → dist/
bun run dev       # local dev server
```

The site is fully static (no backend). Built with [Astro](https://astro.build/) and vanilla JS for search. PDFs live under `public/papers/` and ship as static assets.

## Project structure

```
csvtu-pyq/
├── public/
│   ├── papers/                    # 5,099 PDFs organized as Course/Branch/Sem/Topic/Subject/Year/
│   └── manifest.json              # generated for runtime search
├── scripts/
│   └── build-manifest.ts          # walks public/papers/ → src/data/manifest.json
├── src/
│   ├── data/manifest.json         # bundled at build time for static rendering
│   ├── layouts/Base.astro         # shell with header/footer
│   ├── pages/
│   │   ├── index.astro            # home + global search
│   │   └── c/[...slug].astro      # course / branch / sem views
│   └── styles/global.css          # design system
└── astro.config.mjs
```

## Deploy

Push to `main` → GitHub Actions runs `bun run build` → publishes `dist/` to GitHub Pages.

## Credits

Papers sourced from public CSVTU archives. This project just organizes and serves them.
