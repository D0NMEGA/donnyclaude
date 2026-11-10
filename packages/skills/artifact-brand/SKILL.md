---
name: artifact-brand
description: The owner's page-design protocol for anything published with the Artifact tool or rendered as a print PDF - BNCR brand tokens and logo rule, layout and copy rules for every project, and print pagination. Load before writing any artifact page, dashboard, plan page or PDF.
---

# Artifact design (pages, dashboards, plans published with the Artifact tool)

Set 2026-11-04 after two BNCR artifacts shipped off-brand (decorative fonts, an amber accent,
eyebrow labels, 01/02/03 markers, no logo). Every artifact follows the design protocol the
BNCR website and lab demo established. For non-BNCR work the same discipline applies with that
project's own tokens; when a project has no system, use the structural rules below and say so.

## BNCR artifacts: the brand system, not a new one

Source of truth: `~/Developer/BNCR/site/css/site.css` (tokens at the top), `site/CLAUDE.md`
(constraints and conventions), `labdemo/web/show.css` (the projector show: "one thing at a
time, colour only where it carries meaning, nothing floats over a 3D view"). Read the token
block before writing a page; do not invent a palette.

- Logo top-left on every BNCR-related artifact. The approved mark is
  `~/Developer/BNCR/site/assets/bncr-logo.svg` (identical copies in `labdemo/web/` and
  `easter-egg/site/`). Inline the SVG (strip the xml declaration) in a header bar, height 40
  to 44 px, width auto, `alt`/title "BNCR". Never redraw, recolor, crop or restyle it. The
  Artifact CSP blocks external images, so inline it or publish it as a supporting file.
- Page: white `#ffffff`, ink `#0b1020`, secondary ink `#394256` and `#636c80`, lines
  `#e3e8f0` and `#ccd4e2`, soft fill `#f6f8fc`. Single light theme, set deliberately
  (`color-scheme: light`, explicit body background), because the brand is a clean white
  typographic page.
- Accent: the four logo blues only. Primary `#174bff` (deep `#1236c9`), then `#3976e3`,
  `#60a5fa`, `#9dd9f6`; soft fill `#eef3ff`. No amber, terracotta, purple or "AI gradient".
- Semantic colour from the show, used only where it carries meaning: green `#12a150`
  for running or allowed, red `#c4271b` (soft `#fdeeec`) for an incident, blue `#1f5bd8`
  (soft `#edf3ff`) for a refusal by BNCR, and orange `#c2410c` (wash `#fff3ec`) is reserved
  for one thing: an unauthorized action that executed.
- Type: Geist for text, Geist Mono for data, ids, timestamps and labels. The site self-hosts
  them; an artifact loads them from Google Fonts (`family=Geist` and `family=Geist+Mono`, the
  only stylesheet host the CSP allows) with `ui-sans-serif, system-ui` and `ui-monospace`
  fallbacks. Body 16 to 17 px, line-height 1.6, headings tight (`letter-spacing: -0.01em`),
  `font-variant-numeric: tabular-nums` wherever digits line up.
- Layout: max width 1200 px, 24 px gutter, edge padding `clamp(24px, 3vw, 48px)`, radius 12 px,
  one reading column near 72ch for prose, tables and diagrams in their own `overflow-x: auto`
  container, sticky first column on wide matrices. Phone width works without sideways scroll.
- Copy on the page follows the writing rules: ASCII only, no em or en dashes, straight quotes,
  sentence-case headings, no eyebrow labels, no numbered 01/02/03 section markers unless the
  content is a real sequence, no emoji, no "Bold label:" bullets, development-stage verbs for
  anything not built ("building", "designed to"). Check every public claim against ADR 0001's
  placeholder list and the brand handoff's claims-not-to-publish table.
- Art: no placeholder rectangles, clip art or stock icons. A diagram is drawn to scale with
  explicit geometry, or left out. Status is shown as a pill or a stripe with the semantic
  colour, never as an emoji.
- Motion: none by default; if used, one orchestrated moment, and `prefers-reduced-motion`
  honoured.

## Every artifact, any project

- Read the project's design system first (`CLAUDE.md`, a tokens file, the live stylesheet).
  Precedence: the user's words, then the project's system, then the artifact-design skill's
  defaults.
- Open with the content, not a hero: the title, one line of context, then the thing itself.
  Put the summary before the detail. Cards and shadows only where an element must stand apart.
- One accent, semantic colours separate from it, neutrals with a deliberate hue bias.
- Tables: a header row, consistent column widths, tabular digits, a legend when cells use
  glyphs. Charts: one scale, labels at values the chart reaches, both themes readable.
- Before publishing, check the page against this list, then against the artifact-design
  skill's "avoid AI-generated design" list. If it matches either, fix it before the link.
- Name the page like a product (two to four words); put the explanation in the description.

Vault copy with the reasoning: `~/vault/Practices/BNCR-Artifact-Design.md`.

## Patterns from the demo and the site (added 2026-11-04 after the Genesis PDF)

The owner's words on the first Genesis PDF: "there are eyebrows that contain information no
one cares about or if it is important is formatted in such a way that is unreadable." What it
had: grey monospace sublines under every table row, a mono header line, a strip of tiny mono
labels, matrix group rows in 7 pt. Never again. The patterns to use instead, all taken from
the running demo and bncr.ai:

- One bold result sentence at the top, the way the show says "Result: without BNCR the
  hijacker won. With BNCR the lab won." The headline carries the conclusion, not a label.
- Cards with a short uppercase title (WITHOUT BNCR, HOW BNCR PERFORMED) and one large verdict
  line in the semantic colour, then label-value rows: label in regular weight, value in bold,
  on one line each. That is the only place a small uppercase label is allowed, and it names
  the card, never annotates a row.
- Numbers are the design: "12 of 12", "0.23 ms in total", "$5,400" at display size, with
  tabular digits. A metric nobody would read aloud does not go on the page.
- Status as a pill (BREACHED, DONE, BLOCKED) in the semantic colour; a verdict line in red or
  green; everything else in ink. No decorative colour.
- Monospace only for machine text: commands, the agent's chatter, ids. Never for captions,
  dates, sources or metadata.
- No sublines, footnote-style basis notes or grey meta under rows. Verification and sources go
  in one plain paragraph at the end, in body size.
- Nothing below 9 pt in print or 13 px on screen. If it does not fit at that size, it does
  not belong on the page.
- A quote block (left rule, bold line, one-line attribution) for the sentence that matters.
- Site pages: one large headline, one paragraph, a blue pill CTA and a secondary outline
  button, then three plain facts with blue dots. Cards carry a drawn illustration, a title, a
  two-line description and an "Open larger view" link, never an icon.

## Print PDFs (added 2026-11-04 after the pagination fault)

- Design each page as a fixed page, never a scroll. One block per page: a table, a matrix, a
  card row. Put `break-inside: avoid` on every table and card row and a forced page break
  before each block that needs a page of its own.
- Measure before rendering: Letter with 0.55 in top and 0.6 in bottom margins leaves about
  709 pt. Sum the block heights in print emulation (`getBoundingClientRect().height * 0.75`)
  and cut content until the sum fits; do not let the renderer decide.
- Rasterize every page (`pdftoppm -r 60 -png`) and look at each one before handing over. A page
  count is not a check.
- No closing page that restates the document. A document ends when its content ends; the
  contact line goes under the last block.
