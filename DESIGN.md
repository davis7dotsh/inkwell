---
name: Inkwell
description: A calm private library for serious cross-device reading and research.
colors:
  paper: "#F5F3EE"
  library-leaf: "#FCFBF7"
  muted-leaf: "#EEEDE8"
  deep-ink: "#172A3E"
  quiet-ink: "#526576"
  marginalia: "#7B8995"
  hairline: "#D9D9D3"
  brush-blue: "#1F5B8B"
  brush-blue-deep: "#173F6E"
  stroke-blue: "#2F6F9D"
  wash-blue: "#A7C5D8"
  mist-blue: "#E8EFF3"
  code-paper: "#ECEBE6"
  seal-red: "#B0413E"
  night-paper: "#17181A"
  night-leaf: "#1E2022"
  night-ink: "#E7E9EC"
  night-quiet-ink: "#A4ABB4"
  night-marginalia: "#737A84"
  night-hairline: "#2B2E32"
  night-brush-blue: "#6FA3DC"
  night-brush-blue-strong: "#84B1E3"
  night-mist-blue: "#1E2C3D"
  night-wash-blue: "#31506F"
  night-seal-red: "#E08A85"
typography:
  display:
    fontFamily: "Georgia, Iowan Old Style, Times New Roman, serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: 1.18
    letterSpacing: "normal"
  headline:
    fontFamily: "Georgia, Iowan Old Style, Times New Roman, serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "normal"
  title:
    fontFamily: "Georgia, Iowan Old Style, Times New Roman, serif"
    fontSize: "19px"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "normal"
  body:
    fontFamily: "Georgia, Iowan Old Style, Times New Roman, serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.67
    letterSpacing: "normal"
  ui:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.38
    letterSpacing: "normal"
  mono:
    fontFamily: "Menlo, Consolas, Liberation Mono, monospace"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.48
    letterSpacing: "normal"
rounded:
  xs: "4px"
  sm: "8px"
  md: "10px"
  lg: "16px"
  control: "22px"
  floating: "28px"
  pill: "999px"
spacing:
  hairline: "1px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  xxl: "28px"
  section: "48px"
components:
  button-primary:
    backgroundColor: "{colors.brush-blue}"
    textColor: "{colors.library-leaf}"
    typography: "{typography.ui}"
    rounded: "{rounded.control}"
    padding: "0 22px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.library-leaf}"
    textColor: "{colors.brush-blue}"
    typography: "{typography.ui}"
    rounded: "{rounded.control}"
    padding: "0 22px"
    height: "44px"
  input:
    backgroundColor: "{colors.library-leaf}"
    textColor: "{colors.deep-ink}"
    typography: "{typography.ui}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
  filter-chip:
    backgroundColor: "{colors.library-leaf}"
    textColor: "{colors.quiet-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "6px 14px"
  article-row:
    backgroundColor: "transparent"
    textColor: "{colors.deep-ink}"
    dividerColor: "{colors.hairline}"
    padding: "19px 4px"
  glass-icon-control:
    textColor: "{colors.brush-blue}"
    rounded: "{rounded.pill}"
    size: "40px"
    height: "40px"
    width: "40px"
  annotation-toolbar:
    textColor: "{colors.quiet-ink}"
    rounded: "{rounded.floating}"
    padding: "8px 6px"
---

# Design System: Inkwell

## 1. Overview

**Creative North Star: "The Private Library"**

**Approved mobile direction: "Quiet Shelves"**

Inkwell should feel like opening a private library that is always arranged for
one serious reader. The atmosphere is calm, mature, and quietly personal. The
interface supports collection and study, but the reading surface always has
priority over the product surrounding it.

The physical scene is a reader working alone in a quiet room, moving between a
desk, an iPad in a chair, and an iPhone while away from the desk. Ambient light
changes across those settings, so Inkwell follows the system appearance and
provides equally considered paper and night-study themes. The hierarchy,
density, and restraint should carry the same identity in both.

Apple Books is the primary quality anchor: native behavior, confident
typography, low interface noise, and controls that feel available without
competing with the text. Inkwell rejects children's journal styling,
scrapbook decoration, gamified productivity, and generic dashboard layouts.

**Key Characteristics:**

- Reading-first hierarchy with controls receding at rest.
- Restrained color, with brush blue reserved for action and selection.
- Native iOS and iPadOS behavior where the platform offers a superior control.
- Serif content paired with system UI typography.
- Subtle tonal layering, with shadows reserved for true floating elements.
- Cross-device consistency without forcing identical layouts.
- Open typographic library rows separated by space and hairlines, never a stack
  of floating cards.
- Progressive capture that expands from a compact Add control only when needed.

## 2. Colors

The palette is a restrained ink-wash system: warm paper, deep blue ink, and one
brush-blue action voice, with seal red reserved for destructive or failed
states.

### Primary

- **Brush Blue**: Primary actions, active tools, current filters, progress, and
  keyboard focus. It is never decorative filler.
- **Deep Brush Blue**: Hover and pressed reinforcement on web. Native platforms
  should prefer system-provided pressed feedback when available.

### Secondary

- **Stroke Blue**: Links, annotation outlines, and secondary active marks.
- **Wash Blue**: Hairline emphasis, annotation borders, and the restrained
  brush-stroke signature.
- **Mist Blue**: Selection backgrounds, focus halos, pending states, and note
  surfaces.

### Tertiary

- **Seal Red**: Destructive actions, failed saves, and irreversible warnings.
  It must never become a general accent.

### Neutral

- **Paper**: The default app canvas and reading background.
- **Library Leaf**: Opaque controls, rows, inputs, and elevated reading-adjacent
  surfaces in light appearance.
- **Deep Ink**: Primary text and article content.
- **Quiet Ink**: Secondary copy, metadata with useful emphasis, and inactive
  controls.
- **Marginalia**: Tertiary metadata, placeholders, and low-priority labels.
- **Hairline**: Dividers, field outlines, and container boundaries.
- **Night Paper / Night Leaf**: Neutral dark surfaces for night reading. They
  remain charcoal, never blue-black.
- **Night Ink / Night Quiet Ink / Night Marginalia**: Dark-appearance text
  hierarchy.

**The One Brush Rule.** Brush blue is used for primary action, selection, focus,
and progress only. If a blue element does not communicate one of those roles,
remove the blue.

**The Quiet Night Rule.** Dark appearance uses neutral charcoal surfaces and
lifted blue accents. Pure black, blue-black canvases, and neon accents are
forbidden.

## 3. Typography

**Display Font:** Georgia, with Iowan Old Style and Times New Roman fallbacks

**Body Font:** Georgia, with the same editorial fallbacks

**UI Font:** The native system sans stack
**Label/Mono Font:** Menlo, with Consolas and Liberation Mono fallbacks

**Character:** Reading typography is bookish and composed, while controls use
the native system voice. Serif belongs to articles, titles, and document
structure. System sans belongs to navigation, actions, metadata, and status.

### Hierarchy

- **Display** (700, 34px, 1.18): The Inkwell wordmark and rare top-level
  identity moments.
- **Headline** (700, 32px, 1.25): Article titles and primary reading headings.
- **Title** (700, 19px, 1.35): Library item titles and compact document
  hierarchy.
- **Body** (400, 18px, 1.67): Long-form reading, capped near 70 characters per
  line on mobile and 75 characters on web.
- **UI** (500, 15px, 1.4): Buttons, fields, navigation, and concise product
  copy.
- **Label** (600, 13px, 1.38): Filters, metadata controls, statuses, and
  compact actions.
- **Mono** (400, 13.5px, 1.48): Code blocks and literal technical content.

**The Two Voices Rule.** Serif communicates source material and intellectual
structure. System sans communicates the application. Never use display serif
for button labels, form controls, or status text.

**The Reading Measure Rule.** Prose measure and line height are functional
tokens. Do not widen article text to fill available screen space.

## 4. Elevation

Inkwell is subtly layered. Tonal contrast and hairline boundaries establish
most hierarchy. Shadows appear only when an element genuinely floats above
content: a toolbar, drawer, popover, note, or voice-memo control.

### Shadow Vocabulary

- **Ambient Row Lift** (`0 2px 10px rgba(27, 79, 138, 0.08)`): Web hover
  feedback for a selectable library row.
- **Annotation Lift** (`0 2px 6px rgba(27, 79, 138, 0.18)`): Notes and memo
  chips that sit spatially above article content.
- **Floating Control Lift** (`0 6px 14px rgba(14, 46, 82, 0.16)`): Fallback
  treatment for mobile toolbars when native Liquid Glass is unavailable.
- **Overlay Lift** (`0 12px 36px rgba(9, 24, 40, 0.20)`): Drawers and large
  transient panels.

**The Glass Boundary Rule.** Native Liquid Glass is for navigation, toolbars,
and compact transient controls that float above the task. Article surfaces,
library rows, notes, forms, and content containers remain opaque. Decorative
glass cards are forbidden.

**The Flat-at-Rest Rule.** Resting content surfaces do not cast shadows. A
shadow must explain hover, spatial annotation, or transient elevation.

## 5. Components

### Buttons

- **Shape:** Native continuous curves on Apple platforms. Primary controls use
  a 44px height and a 22px capsule radius.
- **Primary:** Brush-blue fill with a light label. One primary action per local
  task group.
- **Hover / Focus:** Web hover deepens the brush blue. Keyboard focus uses a
  visible mist-blue halo and a stroke-blue boundary. Native controls use system
  pressed and focus behavior.
- **Secondary:** Opaque leaf surface, hairline border, brush-blue label.
- **Icon controls:** Circular native Liquid Glass on supported iOS and iPadOS.
  The fallback is an opaque leaf surface with a hairline boundary.
- **Disabled:** Reduced emphasis without removing the label or icon.

### Chips

- **Style:** Compact capsules using system sans labels. Unselected filters use
  an opaque leaf and hairline boundary.
- **State:** Selected filters use brush blue and a light label. Status chips use
  mist blue, seal tint, or a neutral outline according to meaning.
- **Rule:** Chips communicate filtering or state. They are never decorative
  badges.

### Cards / Containers

- **Corner Style:** Quiet continuous corners for modal sheets, fields, and
  transient controls.
- **Background:** Opaque leaf over the paper canvas.
- **Shadow Strategy:** Flat at rest. Selectable web rows gain only the ambient
  hover lift.
- **Border:** One-pixel hairline boundary.
- **Internal Padding:** 16px vertically and 16px to 18px horizontally.
- **Rule:** Library content uses open rows with full-width hairline separators,
  not rounded card containers. Prefer rows, sections, and open space over card
  grids. Nested cards are prohibited.

### Inputs / Fields

- **Style:** Opaque leaf background, hairline outline, 44px control height, and
  a 22px capsule radius for primary capture fields.
- **Focus:** Stroke-blue boundary with a 3px mist-blue halo on web. Native fields
  use platform focus and keyboard behavior.
- **Error / Disabled:** Error text and boundaries use seal red. Disabled fields
  retain readable content and reduce emphasis.

### Navigation

- **Style:** Navigation is quiet, predictable, and native. Titles remain
  centered or structurally anchored; back actions use familiar platform
  affordances.
- **Mobile treatment:** Native Liquid Glass is preferred for floating back,
  export, outline, and tool controls. Safe areas and platform hit targets are
  mandatory.
- **Web treatment:** Sticky reading navigation uses a lightly translucent paper
  bar with restrained blur, never a decorative glass panel.
- **Active state:** Brush blue communicates current location or selection.

### Article Row

Article rows are the primary library primitive. They carry a serif title,
compact metadata, a restrained status, and at most two lines of excerpt. The
entire ready row is selectable. Rows rest directly on the paper canvas with
hairline separators. Rename and delete remain available through a visible
actions control, long press, and swipe.

### Library Capture

The Add control is compact at rest. Activating it expands an opaque inline
capture area containing the URL field, paste action, PDF import, and Save. It
collapses after a successful submission or when the user closes it.

### Annotation Toolbar

The toolbar is a native floating control surface. On iPad it forms a vertical
tool rail near the reading edge; on iPhone it becomes a bottom control group.
Only tools supported by the device are shown. Selection uses a mist-blue fill,
not a larger icon, bright color, or animation. The iPad rail swipes toward the
right edge to dismiss and returns the reader to reading mode. A barely visible
edge handle with a full-size touch target restores it.

### Notes and Voice Memos

Notes and memo chips are spatial annotations, not generic cards. They use mist
blue, a wash-blue boundary, compact system typography, and the annotation lift.
Their placement must remain connected to the source material at every scale.

## 6. Do's and Don'ts

### Do:

- **Do** make reading content the strongest visual element on every article
  screen.
- **Do** use native iOS and iPadOS Liquid Glass for floating navigation and
  tool controls when the platform API is available.
- **Do** preserve opaque paper-like surfaces beneath prose, notes, rows, and
  forms.
- **Do** use brush blue only for action, selection, focus, and progress.
- **Do** support system appearance, Dynamic Type where practical, VoiceOver,
  keyboard navigation on web, visible focus states, and reduced motion.
- **Do** adapt layout by device while preserving one component vocabulary.
- **Do** use state motion between 150ms and 250ms with an ease-out curve.

### Don't:

- **Don't** resemble a children's journal, scrapbook, diary, or gamified
  note-taking app.
- **Don't** use playful stationery motifs, stickers, novelty illustrations,
  bubbly controls, rainbow palettes, handwriting effects, or celebratory
  animation.
- **Don't** turn reading into a generic productivity dashboard of metrics,
  badges, and card grids.
- **Don't** use Liquid Glass for article containers, library rows, notes, input
  fields, or decorative background panels.
- **Don't** use pure black, pure white as a new token, neon color, gradient
  text, or decorative gradients.
- **Don't** use colored side-stripe borders thicker than 1px on cards,
  callouts, list items, or alerts.
- **Don't** use display serif for controls, labels, data, or form text.
- **Don't** animate layout properties, use bounce or elastic easing, or add
  motion that does not communicate state.
- **Don't** invent unfamiliar controls when a native platform affordance already
  solves the task.
