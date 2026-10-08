I have loaded tasteskill v2 (experimental) as my only source of design rules.

Brief:

- Site: Arturo Nava Personal Engineering Portal & Technical Portfolio (https://arturonavax.dev, repository root /home/arthurnavah/repos/github.com/arturonavax/personal-website).
- Mode: Redesign - Overhaul (full visual modernization and aesthetic elevation with strict preservation of content, routes, and architecture).
- Target Profile: Senior / Staff Backend, Distributed Systems & AI Engineer (specializing in Go, Rust, High Concurrency, Low Latency, Cloudflare Pages/Workers Edge Infrastructure, Hexagonal Architecture, and Zero-Trust DevSecOps).
- Audiences:
  1. Technical Recruiters & Headhunters: Seeking Staff / Principal / Senior Backend & Infrastructure engineers (scanning career history, impact metrics, interactive CV, and downloadable A4 print CV).
  2. Potential Tech Clients & Engineering Leadership: Seeking high-tier consulting in high-concurrency systems, sub-50ms fraud engines, autonomous AI agent pipelines, SOC 2 compliance, and distributed architecture.
  3. Fellow Engineers & Tech Visitors: Reading deep technical essays, inspecting live telemetry labs, and exploring open-source projects.
- Site Surfaces & Scope:
  1. Landing Page: Hero, key operational metrics, core philosophies/pillars, featured projects, career highlights, technical notes, and direct contact hub.
  2. Systems Portfolio (/projects/): Deep architectural breakdowns of distributed systems and backend infrastructure.
  3. CV Showcase & Studio (/resume/ and /resume/maker/): Interactive curriculum vitae with dynamic recruiter tagging and pixel-perfect A4 print stylesheets (@media print).
  4. Personal & Technical Blog (/blog/): Deep technical essays and engineering notes with high-readability typography.
  5. Services Showcase (/services/): Consultation offerings (Anti-fraud engines, RAG pipelines, high-concurrency backends, Staff mentorship).
  6. Case Studies & Telemetry (/case-studies/ and telemetry lab): Interactive sub-50ms pipeline demonstrations.
  7. Quick Links (/links/) and Universal Search (/search/): Lightweight utility surfaces.
- Tech Stack & Performance Invariants:
  - Framework: Astro (v5 Content Layer API, SSG output: 'static', pure edge compilation).
  - Styling: Tailwind CSS v4 (@import "tailwindcss" in src/styles/global.css).
  - Client JavaScript Budget: 0 KB baseline client JS. Interactive primitives must use native HTML5/CSS (:has(), <details>, :popover, CSS grid, CSS transitions). Any JavaScript must be scoped vanilla script or Web Components only when strictly required for irreversible user interaction.
  - Core Web Vitals Targets: 100/100 (LCP < 0.8s, INP = 0ms, CLS = 0.000, TTFB < 25ms).
  - SEO & Machine Readability: 100/100 SEO. Normalized canonical URLs with trailing slash, reciprocal hreflangs (en, es, x-default), and complete JSON-LD structured data with stable anchor @id: "https://arturonavax.dev/#person".
- Aesthetic Direction & Creative Freedom:
  - Aesthetic Family: Industrial Brutalism & Tactical Telemetry UI meets Swiss Typographic Print.
  - Creative Freedom: Total creative freedom to engineer unique layout compositions, high-contrast typography, and blueprint modular grids, while rigorously honoring a Staff Software Engineer profile.
  - Color System: Preferred palette centers on Vinotinto / Granate (garnet / deep wine #7a1c16, #3a0307) with precision accents (such as amber/gold #d48b38 or hazard alert accents).
  - Dual Theme Support (Light & Dark):
    - Light Substrate (Swiss Industrial Print): Matte unbleached documentation paper (#F4F4F0 / #EAE8E3), carbon ink typography (#111111), hairline dividing borders (#cbd3da / #CBD5E1), and deep garnet / vinotinto accents (#7A1C16).
    - Dark Substrate (Tactical Telemetry CRT): Deactivated CRT deep slate (#0A0A0A / #121212), white phosphor typography (#EAEAEA / #FFFFFF), structural hairline borders (#27272A / #4D0E12), and deep garnet / vinotinto with amber/gold telemetry accents.
    - Theme Lock: One unified theme for the whole page per user selection. Absolutely zero light/dark flips mid-page.
- Dial Settings:
  - DESIGN_VARIANCE: 7 (Asymmetric, structural, distinctive architectural layout)
  - MOTION_INTENSITY: 3 (Performance-first: CSS native micro-interactions, tactile hover feedback, zero heavy JS animation libraries to guarantee 0 KB client JS and 0ms INP)
  - VISUAL_DENSITY: 6 (Engineered data density, telemetry readouts, balanced with clean negative space)
- What works today (Must preserve and elevate):
  - Pure Astro Edge SSG architecture with 0 KB baseline client JS.
  - Rich bilingual content collections in src/content/ (experience, posts, projects, services, resume).
  - Hexagonal Architecture (src/lib/ports/, src/lib/adapters/).
  - High-value functional features: Interactive Resume Maker (/resume/maker/), A4 print normalization, live telemetry demo, and search modal.
- What is broken / Needs overhaul:
  - Visual clutter: legacy gradients, inconsistent borders, repetitive pill badges, and AI tells.
  - AI Tells to eradicate: decorative status dots, em-dashes, timezone strips ("Bogotá UTC-5"), generic card containers, and hand-rolled decorative SVGs.
  - Identity elevation: Upgrade from a generic developer template to an unmistakable, high-conviction Industrial Brutalist & Precision Telemetry portal.
- SEO & Architecture Constraints:
  - Keep 100% of route slugs unchanged: /, /blog/, /projects/, /services/, /experience/, /resume/, /resume/maker/, /case-studies/, /links/, /search/ (and their /es/ mirrors).
  - Primary nav labels, form field names, canonical URL logic, JSON-LD schemas, and i18n dictionaries must remain intact unless explicitly approved.

Quick Reminders (Mandatory Anti-Slop Non-Negotiables):

1. Zero em-dashes anywhere. Hyphen only. (Strictly ban both em-dash and en-dash characters in headlines, eyebrows, pills, body copy, quotes, and metadata. Use hyphen '-' or periods/colons).
2. Hero headline max 2 lines. Subtext max 20 words. CTA visible without scroll. (Hero must fit in initial viewport without scroll).
3. Navigation max 80 pixels tall, one line at desktop.
4. Bento grid: N items equals N cells. No empty cells.
5. One theme for the whole page (no light/dark flips mid-page).
6. Real images, no div-based fake screenshots, no hand-rolled SVG illustrations. (Use real profile image arturonava.png, Simple Icons / devicon for tech stacks, or real component previews).
7. No section-numbering eyebrows, no version labels in hero, no scroll cues, no locale strips, no decorative status dots.
8. If MOTION_INTENSITY is greater than 4, the page actually animates. Otherwise drop the dial. (Dial is set to 3; keep animations CSS-native, lightweight, and purposeful).
9. Eyebrow restraint: Maximum 1 eyebrow per 3 sections across the whole page (Hero counts as 1).
10. Button wrap & contrast: Every CTA label fits on one line at desktop; WCAG AA contrast verified. No duplicate CTA intent across the page.

Execution Protocol:

Step 1. Run the Section 11 audit (Section 11.B in tasteskill v2) in writing:

- Brand tokens currently in use (primary, accent, type stack, radii)
- Information architecture (page tree, nav, key conversion paths)
- Content blocks (what exists, what does work, what is filler)
- Patterns to preserve (signature interactions, recognizable hero elements, copy voice)
- Patterns to retire (AI-slop tells, em-dashes, broken layouts, dead links, decorative dots, locale strips)
- Inferred dial reading of the current site (DESIGN_VARIANCE, MOTION_INTENSITY, VISUAL_DENSITY)
- SEO baseline (ranking pages, titles, canonicals, JSON-LD structured data)
  Post the audit in writing. Stop.

Step 2 (after my OK). Declare the mode (Redesign - Overhaul), output the one-line Design Read, declare dial values (7 / 3 / 6), specify semantic color tokens for Light and Dark modes, and declare which modernization levers from Section 11.D you will apply in priority order. Stop.

Step 3 (after my OK). Implement the changes across Astro layouts, UI components, Tailwind v4 global CSS, and page templates. Keep URL structure, primary nav labels, form field names, brand logo, and legal copy unchanged unless explicitly approved.

Step 4. Run in writing:

- Em-dash audit (prove zero em-dashes or en-dashes exist across all modified components)
- Pre-Flight Check (Section 14 matrix in tasteskill v2, box by box)
- Preservation audit: list every URL, nav label, form field, and anchor changed (must be empty unless approved)
- Dual-theme fidelity audit: confirm Light mode (Swiss Industrial Print) and Dark mode (Tactical Telemetry CRT) with garnet/vinotinto accents survived with strict contrast and 0 mid-page flips
- Core Web Vitals & 0 KB client JS audit: verify 100/100 CWV posture, zero unnecessary scripts, and zero layout shifts

Any Fail blocks completion.
