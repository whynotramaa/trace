---
name: Trace
description: Technical search with visible ranking evidence.
colors:
  primary: "#1d6454"
  primary-hover: "#154b3f"
  paper: "#f7f8f7"
  panel: "#ffffff"
  ink: "#202b26"
  muted: "#58665e"
  divider: "#d5ddd7"
  wash: "#e7efea"
typography:
  display:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "clamp(38px, 4.5vw, 60px)"
    fontWeight: 620
    lineHeight: 1.1
    letterSpacing: "-0.035em"
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "21px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.015em"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.65
  evidence:
    fontFamily: 'ui-monospace, "SFMono-Regular", Consolas, monospace'
    fontSize: "11px"
rounded:
  control: "4px"
  panel: "6px"
  search: "7px"
spacing:
  small: "8px"
  group: "12px"
  section: "24px"
  desktop-gutter: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.panel}"
    rounded: "{rounded.control}"
    padding: "13px 22px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  query-token:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.ink}"
    padding: "4px 7px"
---

# Design System: Trace

## Overview

Trace puts source titles and readable excerpts beside optional ranking evidence. The interface uses neutral backgrounds, muted teal actions, thin separators, and native form controls. Search and Inspect share the same typography and spacing.

**Key Characteristics:**

- Readable source results
- Optional engine evidence
- Neutral backgrounds and muted teal actions

These rules describe the implemented Phase 2 interface in `web/style.css` and `web/app.tsx`. Product facts belong in `PRODUCT.md`; the search composition belongs in `.impeccable/surfaces/search.md`.

## Colors

Teal identifies source links, actions, focus, and score contributions. Paper surrounds white input and Inspect backgrounds. Ink carries primary content, muted text carries supporting details, and divider lines separate groups. Wash marks analyzed terms and active Inspect controls.

Selection uses a pale green background and dark green text. Disabled controls reduce opacity. Focus uses a two-pixel teal outline with a four-pixel offset.

## Typography

System sans serves interface text and source content. Result titles are semibold; excerpts use a comfortable line height and a maximum measure of 72 characters. On narrow screens, result titles reduce to 19 pixels and excerpts to 14 pixels. Analyzed tokens and the evidence table use monospace. Other engine measurements use sans with tabular numerals.

## Layout

The page has a maximum width of 1,440 pixels, with desktop gutters of 48 pixels. The query and ordinary results occupy at most 840 pixels. Opening Inspect creates a second column with a 40-pixel gap. Its width ranges from 400 to 490 pixels.

At 1,100 pixels the gutters and column gap tighten. At 1,000 pixels Inspect follows results in one column and loses sticky positioning. Opening it scrolls to the panel. At 600 pixels the gutters reduce to 20 pixels and controls become more compact.

## Elevation & Depth

The interface uses flat backgrounds and borders. White backgrounds distinguish editable controls and Inspect from the surrounding paper. It has no decorative shadows.

## Shapes

Controls have gently rounded corners. Inputs and Inspect have slightly larger radii. Results form a continuous list with divider lines rather than separate boxes. Search and close icons use authored SVG strokes.

## Components

The search form combines its icon, labeled input, and submit button in one border. Focus changes that border to teal. The input remains visible while results load; the disabled submit button states that search is running.

Results expose the source, post type, rank, title, excerpt, author, contribution license, date, and Inspect action. Selecting a result in Inspect underlines its title. Empty and failed searches use text guidance and recovery controls.

Inspect groups the query pipeline, analyzed terms, and selected result ledger. A native select changes the result. The table scrolls within its own region when necessary. Escape closes the panel and returns focus to its opener. Hover feedback uses a short color transition only when reduced motion is not requested.

## Do's and Don'ts

- Do keep source titles and excerpts readable before exposing engine details.
- Do preserve source links and attribution.
- Do use monospace for analyzed query terms and term evidence. Use tabular numerals for other measurements.
- Do obtain scores, counters, and timing values from the server trace.
- Don't reconstruct ranking values in the interface.
- Don't turn request timings into benchmark claims.
- Don't add later-phase controls before their engine behavior exists.
