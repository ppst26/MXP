---
version: alpha
name: Linear
website: "https://linear.app"
description: "A near-black product-focused marketing canvas built around \"#010102\" (the deepest dark surface of any tool in this collection), light gray text (\"#f7f8f8\"), and the signature Linear lavender-blue (\"#5e6ad2\") used as the single chromatic accent. The system reads as software-craft documentation: dense, technical, and quietly luxurious. Display type is set in the Linear custom sans (SF Pro Display fallback) at 500-700 with measured negative tracking. Cards live as charcoal panels (\"#0f1011\") with hairline borders. The accent lavender appears on the brand mark, focus rings, and a few intentional CTAs — never decoratively. Page rhythm leans on product UI screenshots framed in dark panels rather than atmospheric color."

seo:
  title: "Linear Design System for React — Lavender (#5e6ad2), Linear Display, 22 components"
  metaDescription: "Linear's design system as a DESIGN.md file. Lavender-blue #5e6ad2, Linear Display sans, 22 colors, 22 components. For React, Next.js, and AI tools."
  highlights:
    - "Deepest dark canvas in the directory — #010102 with a faint blue tint, never pure #000000 true black"
    - "Single chromatic accent — lavender-blue #5e6ad2 reserved for brand mark, focus ring, and primary CTA only"
    - "Four-step surface ladder carries hierarchy without drop shadows — canvas to surface-4 with hairline borders"
    - "Aggressive negative letter-spacing on display — -3.0px at 80px, scaling to -0.05px at 16px body"
    - "Product UI screenshots are the protagonist — marketing chrome is a dark frame for high-fidelity app captures"
  tags:
    - "Project Management"
    - "Productivity & SaaS"
  lastUpdated: "2026-05-12"
  author:
    name: "Dov Azencot"
    url: "https://x.com/dovazencot"
  opening: |
    Linear's marketing site is the strictest dark-canvas system in this directory. The page floor is "#010102" — essentially pure black with a faint blue cast, never the unfortunate "#000000" true black that most dark sites default to. On top sits a four-step surface ladder: charcoal panels at "#0f1011", "#141516", "#18191a", and "#191a1b" carrying every card, hovered tile, and lifted dropdown. Hairlines run from "#23252a" up through "#34343a" and "#3e3e44". The single chromatic accent is Linear's lavender-blue "#5e6ad2", deployed scarcely on the brand mark, focus rings, and one primary CTA per section. There is no second chromatic color, no atmospheric gradient, no spotlight card. Linear trusts surface lift and hairline borders to carry every bit of hierarchy.

    This page packages the entire spec into one DESIGN.md file written to the Google Labs spec. Inside: 22 color tokens grouped into brand, surface, hairline, text, and semantic families; 14 type tokens running Linear Display, Linear Text, and Linear Mono with negative tracking scaling from -3.0px at 80px down to 0 at body; an 8-step rounded scale (4px through 24px plus pill and full); a 9-step spacing scale on a 4px base unit ending at 96px section padding; and 22 component definitions covering buttons, pricing cards, product screenshot panels, testimonial cards, changelog rows, and the dark top-nav and footer.

    Feed the file to Claude, Cursor, or GitHub Copilot and the agent reproduces Linear's discipline — dark canvas, single lavender accent, surface ladder over shadows — rather than a generic dark theme. Or reference the tokens directly: every hex, font, radius, and spacing value is a quoted scalar you can paste into Tailwind config, CSS variables, or your component library. Linear is worth studying because it proves how far restraint scales: a single accent color, one negative-tracking display family, and four surface lifts produce a marketing page that reads as software-craft documentation.
  related:
    - href: "/design"
      title: "Browse all design systems"
      description: "The full directory of DESIGN.md files on shadcn.io, with live mockups for each."
    - href: "https://linear.app/brand"
      title: "Linear brand guidelines"
      description: "Linear's official brand site — wordmark, color usage, and the lavender accent token in context."
    - href: "https://github.com/google-labs-code/design.md"
      title: "The DESIGN.md specification"
      description: "Google Labs' open spec for machine-readable design system files — the format this page is built on."
  questions:
    - id: "primary-color"
      title: "What is Linear's primary brand color?"
      answer: "Linear's brand color is lavender-blue at \"#5e6ad2\" — a desaturated blue-violet sitting between Slack purple and Discord blurple. The hover state lightens to \"#828fff\" and the focus tint settles at \"#5e69d1\". Linear uses lavender scarcely: brand mark, primary CTA, focus ring, and link emphasis only. It never fills cards, never appears as a section background, and never pairs with a second chromatic accent."
    - id: "dark-mode"
      title: "Does Linear's design system have a light mode?"
      answer: "No — the marketing site is dark-only. Canvas is \"#010102\" (essentially pure black with a faint blue tint), with a four-step surface ladder running through \"#0f1011\", \"#141516\", \"#18191a\", and \"#191a1b\" for lifted panels. The spec documents three inverse tokens (\"#ffffff\" canvas, \"#f5f6f6\" and \"#f6f7f7\" surfaces) used only on the rare white pill CTA over a dark section opener. Linear's product UI ships a light theme, but it is not represented in this DESIGN.md."
    - id: "typography"
      title: "What typography does Linear use, and what should I use if Linear Display isn't available?"
      answer: "Linear runs three custom typefaces: Linear Display for headlines, Linear Text for body, and Linear Mono for code. The fallback stack documents SF Pro Display on macOS. None of these are publicly distributed. Inter at weights 500 / 600 / 700 is the closest free substitute, with Geist Sans as another viable option. For mono, JetBrains Mono or Geist Mono at weight 400 closely approximates Linear Mono. The display scale runs from 80px down to 12px with negative letter-spacing scaling aggressively at the top end."
    - id: "negative-tracking"
      title: "Why does Linear use such aggressive negative letter-spacing on display type?"
      answer: "The display scale pulls tracking to -3.0px at 80px, -1.8px at 56px, -1.0px at 40px, and -0.6px at 28px — roughly 4% of font size at the top of the ramp. This compresses headlines optically and gives Linear's voice a precise, mechanical feel that matches the product's keyboard-shortcut-driven UI. Body tracking holds at -0.05px and eyebrow labels use positive tracking (+0.4px) to mark them as taxonomy rather than display."
    - id: "use-in-project"
      title: "Can I use this DESIGN.md to build my own React project management tool?"
      answer: "Yes — the file is designed to be fed into Claude, Cursor, or any AI tool that reads structured design tokens. The agent will reproduce Linear's restraint: dark canvas, single lavender accent, surface ladder over shadows. Reference the tokens directly inside Tailwind config or CSS variables — every color, type style, radius, and spacing value is a quoted scalar. The 22 component definitions cover buttons, pricing cards, product screenshot panels, testimonial cards, and the changelog row used on \"/build\"."
    - id: "known-gaps"
      title: "What's missing from this DESIGN.md spec?"
      answer: "A handful of things, documented in the Known Gaps section: form-field error and validation styling is not visible on the inspected pages; light mode is not documented because Linear's marketing site does not ship a light theme; and Linear's actual product UI uses a richer color-tag palette (red, orange, yellow, green, blue, purple) for issue priorities and project labels that lives inside the in-product surfaces shown in mockups. The four-step surface ladder values are extracted directly from Linear's canonical CSS variables."

colors:
  primary: "#5e6ad2"
  on-primary: "#ffffff"
  primary-hover: "#828fff"
  primary-focus: "#5e69d1"
  ink: "#f7f8f8"
  ink-muted: "#d0d6e0"
  ink-subtle: "#8a8f98"
  ink-tertiary: "#62666d"
  canvas: "#010102"
  surface-1: "#0f1011"
  surface-2: "#141516"
  surface-3: "#18191a"
  surface-4: "#191a1b"
  hairline: "#23252a"
  hairline-strong: "#34343a"
  hairline-tertiary: "#3e3e44"
  inverse-canvas: "#ffffff"
  inverse-surface-1: "#f5f6f6"
  inverse-surface-2: "#f6f7f7"
  inverse-ink: "#000000"
  brand-secure: "#7a7fad"
  semantic-success: "#27a644"
  semantic-overlay: "#000000"

typography:
  display-xl:
    fontFamily: Linear Display
    fontSize: 80px
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: -3.0px
  display-lg:
    fontFamily: Linear Display
    fontSize: 56px
    fontWeight: 600
    lineHeight: 1.10
    letterSpacing: -1.8px
  display-md:
    fontFamily: Linear Display
    fontSize: 40px
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: -1.0px
  headline:
    fontFamily: Linear Display
    fontSize: 28px
    fontWeight: 600
    lineHeight: 1.20
    letterSpacing: -0.6px
  card-title:
    fontFamily: Linear Display
    fontSize: 22px
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: -0.4px
  subhead:
    fontFamily: Linear Display
    fontSize: 20px
    fontWeight: 400
    lineHeight: 1.40
    letterSpacing: -0.2px
  body-lg:
    fontFamily: Linear Text
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.50
    letterSpacing: -0.1px
  body:
    fontFamily: Linear Text
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.50
    letterSpacing: -0.05px
  body-sm:
    fontFamily: Linear Text
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.50
    letterSpacing: 0
  caption:
    fontFamily: Linear Text
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.40
    letterSpacing: 0
  button:
    fontFamily: Linear Text
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.20
    letterSpacing: 0
  eyebrow:
    fontFamily: Linear Text
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.30
    letterSpacing: 0.4px
  mono:
    fontFamily: Linear Mono
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.50
    letterSpacing: 0

rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  xxl: 24px
  pill: 9999px
  full: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  section: 96px

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: 8px 14px
  button-primary-pressed:
    backgroundColor: "{colors.primary-focus}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
  button-secondary:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: 8px 14px
  button-tertiary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: 8px 14px
  button-inverse:
    backgroundColor: "{colors.inverse-canvas}"
    textColor: "{colors.inverse-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: 8px 14px
  pricing-card:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: 24px
  pricing-card-featured:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: 24px
  feature-card:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: 24px
  product-screenshot-card:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
    padding: 24px
  testimonial-card:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.lg}"
    padding: 32px
  customer-logo-tile:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-subtle}"
    typography: "{typography.caption}"
    rounded: "{rounded.xs}"
    padding: 16px
  text-input:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 8px 12px
  text-input-focused:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 8px 12px
  pricing-tab-default:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-subtle}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: 6px 14px
  pricing-tab-selected:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: 6px 14px
  cta-banner:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.headline}"
    rounded: "{rounded.lg}"
    padding: 48px
  changelog-row:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.xs}"
    padding: 24px 0
  status-badge:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: 2px 8px
  top-nav:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.xs}"
    height: 56px
  footer:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-subtle}"
    typography: "{typography.caption}"
    rounded: "{rounded.xs}"
    padding: 64px 32px
---

## Overview

Linear's marketing canvas is the deepest dark surface in this collection — `{colors.canvas}` is "#010102", essentially pure black with a faint blue tint. On top sits a four-step surface ladder (`{colors.surface-1}` through `{colors.surface-4}`) for cards, panels, and lifted tiles, with hairline borders running from `{colors.hairline}` ("#23252a") up through `{colors.hairline-strong}` and `{colors.hairline-tertiary}`. Light gray text (`{colors.ink}` "#f7f8f8") carries the body and headlines.

The single chromatic accent is **Linear lavender-blue** `{colors.primary}` ("#5e6ad2") — used on the brand mark, focus rings, and the primary CTA button. A lighter hover state (`{colors.primary-hover}` "#828fff") and a focus-tinted variant (`{colors.primary-focus}` "#5e69d1") extend the same hue. Linear avoids saturated greens, oranges, reds, etc. on the marketing canvas — the only semantic color is `{colors.semantic-success}` ("#27a644") for status pills and the rare success indicator.

Display type runs Linear's custom sans (with `SF Pro Display` fallback) at weight 500-700 with negative letter-spacing scaling from -3.0px at 80px down to 0 at body. The body family is Linear's text cut, and a Linear Mono is reserved for code snippets in product screenshots.

The page rhythm is **dense product screenshots** — Linear's marketing leads with high-fidelity captures of the product UI (issue list, project view, dashboard) framed in `{colors.surface-1}` panels with `{rounded.xl}` 16px corners. The chrome is intentionally minimal so the app screenshots can do the heavy lifting.

**Key Characteristics:**
- **Dark-canvas marketing system** — `{colors.canvas}` ("#010102") is the deepest dark in this collection.
- **Lavender-blue brand accent** (`{colors.primary}` "#5e6ad2") — used scarcely on brand mark, focus, and the primary CTA.
- Four-step surface ladder (canvas → surface-1 → surface-2 → surface-3 → surface-4) carries hierarchy without shadow.
- Display tracking pulls aggressively negative (-3.0px at 80px); body holds at -0.05px.
- Cards use `{rounded.lg}` 12px corners with 1px hairline borders — never pill, rarely 16px.
- **Product UI screenshots** dominate the page. The marketing chrome is a dark frame for the app.
- No second chromatic color. No atmospheric gradients. No spotlight cards.

## Known Gaps

- The four-step surface ladder values are extracted directly from Linear's `--color-bg-level-3`, `--color-line-tint`, etc. CSS variables; they are Linear's canonical surface spec.
- Form-field error and validation styling is not visible on the inspected pages.
- Light mode is not documented because the marketing site does not ship a light theme.
- Linear's actual product UI uses a richer color-tag palette (red, orange, yellow, green, blue, purple) for issue priorities and project labels — those colors live in the in-product surfaces shown in mockups.
- The custom display, text, and mono families are proprietary; an open-source substitute is acceptable.
