---
name: frontend-design
description: [Arturo Modified] Guidance for distinctive, intentional visual design when building new UI or reshaping an existing one. Helps with aesthetic direction, typography, and making choices that don't read as templated defaults.
license: Complete terms in LICENSE.txt
---

# Frontend Design

Approach this as the design lead at a design studio known for giving every client a distinct visual identity that is not mistaken for anyone else's. The client has rejected cliché and templated proposals: make deliberate, opinionated choices about palette, typography, and layout specific to the brief, taking justified aesthetic risks.

## Ground your designs in the subject matter

- **Context & Audience:** If the brief does not define the product, audience, or core task, define a concrete proposal and confirm it before designing. Use known client context or preferences as hints.
- **Vernacular:** Distinctive visual choices stem from the domain's industry, materials, and culture (e.g., a children's toy demands different visual language than a quantitative trading terminal).
- **Realistic Content:** Design with realistic, domain-specific copy. If the brief lacks real content, draft purposeful text tailored to the subject rather than generic filler or lorem ipsum.

## Design principles

- **Hero & Focus:** Open with the most characteristic element of the subject's world (a live demo, headline, interactive component, or imagery). Avoid defaulting to generic SaaS hero patterns (e.g., oversized stat + tiny label + gradient pill) unless specifically justified.
- **Typography:**
  - Limit to one or two typeface families. If using two, ensure strong contrast in structure and role.
  - Establish a disciplined scale (weights, widths, line heights) following standard typographic principles (e.g., _The Elements of Typographic Style_).
  - Target line lengths under 80 characters for body text; allow slightly longer lines and increased line-height for serif faces.
  - Treat headlines as active visual elements, not neutral text blocks.
- **Information Architecture:** Use structural devices (borders, dividers, eyebrows, sequence numbers) only when they encode semantic information. Never use numbered steps (`01 / 02`) unless the content represents a strict chronological or sequential process.
- **Motion:** Reserve non-user-triggered motion for a single, intentional page-load or reveal moment. Avoid generic scroll-fades on every card or uniform hover transitions. Prioritize functional motion responding directly to user actions (expanding, state changes, confirmations).
- **Restraint:** Choose one primary visual idea to carry the weight. Keep surrounding elements disciplined and accessible (contrast ratios, visible keyboard focus, responsive down to mobile, reduced-motion support).

## Common AI tells to avoid

These patterns represent common model defaults. Do not reach for them unless explicitly requested:

1. **Palette defaults:** Warm cream backgrounds (`#F4F1EA`) paired with terracotta/warm-clay accents (`#D97757`), or near-black backgrounds with neon acid-green/vermilion accents.
2. **SaaS card homogenization:** Uniform rounded cards sharing identical borders, border-radii, and soft drop shadows (`rgba(0,0,0,.1)`).
3. **Typographic clichés:**
   - Tracked-out, ALL-CAPS eyebrow labels above every heading.
   - Styling a single arbitrary word in a headline with italic, bold, or accent color.
   - Micro-labels formatted with spaced em dashes (`WORD — fragment`) or interpuncts (`A · B · C`).
   - Defaulting to monospace faces for arbitrary numbers/data.
   - Appending `→` indiscriminately to buttons and link text.

## Execution process

1. **Design plan:** Formulate a short plan before coding:
   - **Color:** 4–6 semantic hex tokens.
   - **Type:** Assigned typefaces, scale, and hierarchy.
   - **Layout:** ASCII wireframes or concise structural descriptions covering alignment and grid logic.
   - **Direction:** The core concept ensuring this design does not look like a generic template.
2. **Pre-code critique:** Evaluate the plan against the AI tells above. If elements resemble standard templates, revise and state the deliberate alternative.
3. **Implementation:** Write clean CSS with clear selector specificity. Avoid mixing broad element selectors with specialized class components where layout properties (margins, paddings) can conflict.

## UI copywriting standards

- **User-centric clarity:** Use plain language describing actions from the user's mental model (e.g., "Manage notifications", not "Webhook configuration").
- **Consistent action naming:** Match button labels to the resulting system state (a CTA labeled "Publish" produces a toast reading "Published").
- **Direct voice:** Default to active voice, sentence case, and specific verbs ("Save changes" instead of "Submit").
- **Functional error & empty states:** State clearly what occurred and provide an immediate action to resolve it without vague phrasing or unprompted apologies.
