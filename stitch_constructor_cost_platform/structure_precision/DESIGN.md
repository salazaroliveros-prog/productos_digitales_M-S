# Design System Specification: Surgical Structuralism

## 1. Overview & Creative North Star
The Creative North Star for this design system is **"The Blueprint Authority."** 

Construction is an industry of millimeters; digital product sales is an industry of milliseconds. To bridge these, we move away from "web templates" and toward a high-end editorial aesthetic that mimics technical architectural drawings and premium engineering journals. 

This system rejects the "boxed-in" look of traditional SaaS. Instead, it utilizes **Surgical Precision**: a layout philosophy driven by rigid mathematical alignment, expansive whitespace (the "breath" of a blueprint), and intentional asymmetry. We convey "Trustworthy" not through heavy borders, but through the flawless organization of complex data.

---

## 2. Color & Tonal Depth
We utilize a sophisticated palette of deep architectural navies and high-visibility safety oranges. 

### The "No-Line" Rule
**Explicit Instruction:** Designers are prohibited from using 1px solid borders to section content. Traditional "dividers" are a sign of lazy hierarchy. 
- **The Alternative:** Define boundaries through background shifts. A `surface-container-low` card sitting on a `surface` background creates a natural edge. 
- **The Ghost Border:** If a container requires a boundary for accessibility, use the `outline-variant` token at **15% opacity**. Never use 100% opaque lines.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers. Each layer deeper should signify a higher level of detail or "drilling down" into technical data.
*   **Base:** `surface` (#f8f9fa) - The canvas.
*   **Level 1:** `surface-container-low` (#f3f4f5) - Large structural sections.
*   **Level 2:** `surface-container` (#edeeef) - Primary content areas.
*   **Level 3:** `surface-container-highest` (#e1e3e4) - Critical focus areas/Modals.

### The "Glass & Gradient" Rule
To prevent the Deep Navy (`primary`) from feeling flat or "heavy," use a subtle **Directional Glow**. Main CTAs and Hero sections should use a linear gradient: `primary` (#041525) to `primary-container` (#1a2a3a) at a 135-degree angle. This mimics the sheen of polished steel or glass.

---

## 3. Typography: Editorial Authority
We pair **Manrope** (Display) with **Inter** (UI/Data). Manrope provides a structural, geometric feel for headlines, while Inter offers the surgical legibility required for dense price lists.

*   **Display-LG (Manrope, 3.5rem):** Reserved for hero value propositions. Use `-0.02em` letter spacing for a "tight" professional feel.
*   **Headline-MD (Manrope, 1.75rem):** Section titles. Always pair with a high-contrast `secondary` (Orange) accent nearby.
*   **Title-SM (Inter, 1rem, Medium 500):** Used for technical specs and price list headers.
*   **Body-MD (Inter, 0.875rem):** The workhorse. High line-height (1.6) is required to ensure data-heavy technical descriptions remain readable.
*   **Label-SM (Inter, 0.6875rem, All Caps):** Used for metadata, SKU numbers, and technical tags. Increase letter spacing to `0.05em`.

---

## 4. Elevation & Depth
In "Surgical Precision," we avoid the "floating card" look of 2015. Elevation is achieved through **Tonal Layering** and **Ambient Shadows**.

*   **The Layering Principle:** Depth is "stacked." Place a `surface-container-lowest` card on a `surface-container-low` background. The subtle 2% shift in brightness creates a sophisticated "lift" that feels integrated into the architecture.
*   **Ambient Shadows:** For floating elements (Modals, Dropdowns), use a shadow color of `on-surface` at 6% opacity, with a 24px blur and 12px Y-offset. It should look like a soft glow of light, not a "drop shadow."
*   **Glassmorphism:** For overlays or "Quick View" price panels, use `surface-container-lowest` at 80% opacity with a `backdrop-filter: blur(12px)`. This keeps the user grounded in the technical drawing/data behind the panel.

---

## 5. Components

### Technical Price Lists (The Signature Component)
*   **Layout:** No horizontal lines. 
*   **Styling:** Use zebra-striping with `surface-container-low` on even rows. 
*   **Typography:** All currency values should use `title-md` in `on-surface`, while SKU/Ref numbers use `label-sm` in `on-surface-variant`.
*   **Hover State:** On hover, the entire row shifts to `primary-fixed` (#d3e4fa) to provide a "surgical" highlight.

### Structural Buttons
*   **Primary:** Gradient (Navy) with `on-primary` text. Radius: `md` (0.375rem). The corners should feel sharp but not aggressive.
*   **Action (Orange):** Use `secondary` (#865300) only for the highest-priority conversion (e.g., "Request Quote"). 
*   **Tertiary:** No background. Use `label-md` bold with a 2px bottom border using `secondary-container` (#fea520).

### Technical Input Fields
*   **State:** Default uses `surface-container-highest` background with a `ghost border`.
*   **Focus:** The border becomes 2px `primary` (#041525). No "blue glow" outer shadows; use a sharp, clean transition.

### Interactive Spec-Chips
*   **Usage:** For material types or digital product versions.
*   **Style:** `surface-container-low` background, `label-md` text. On selection, the background flips to `primary` and text to `on-primary`.

---

## 6. Do’s and Don’ts

### Do:
*   **Embrace Whitespace:** If a price list feels crowded, increase the vertical padding of the rows, do not add more lines.
*   **Align to the Grid:** Use a 12-column grid. Ensure all technical drawings and data points align strictly to the vertical rhythm.
*   **Use Tonal Transitions:** Use the `surface-container` tiers to guide the eye from the general overview to specific technical details.

### Don’t:
*   **Don't use 100% Black:** Use `on-primary-fixed` (#0c1d2c) for text to maintain the navy tonal depth.
*   **Don't use standard icons:** Use "Thin" or "Light" weight stroke icons (1.5px weight) to match the surgical precision of the typography.
*   **Don't use Rounded-Full:** Avoid pill-shaped buttons unless they are tiny UI tags. We favor the `md` (0.375rem) or `sm` (0.125rem) radius to maintain a structural, architectural feel.