# CLIProxyAPI Console — Interface System ("Switchboard")

## Intent

- **Who:** a developer who self-hosts CLIProxyAPI and pools their own AI subscription accounts
  (Codex, Claude, Antigravity, Kimi, xAI, Devin, Meta…). They open the console in a browser tab
  next to a terminal — usually because something feels off (a client got 429s, an account expired)
  or to check headroom before a long session.
- **Verbs:** see whether the pool is healthy · see how much quota is left and when it resets ·
  add / disable / refresh an account · change a setting · read the log line that explains a failure.
- **Feel:** an operator's switchboard. Dense, calm, exact. Graphite rack, paper-white panels,
  ink for actions, small signal lamps for state. No marketing heroes, no gradients, no glass.

## Domain → visual language

- Domain: credential pool, rate-limit windows, reset clock, routing (round-robin), cooldown,
  upstream provider, management key, YAML config, request log.
- Color world: rack-mounted gear in a dim room — anthracite panels, paper label tape,
  green/amber/red indicator lamps, hairline engraving.
- **Signature: signal lamps + capacity meters.** Every credential has a lamp (ok / warn / fault /
  idle). Quota is a *remaining-capacity* meter with a reset countdown. The sidebar footer carries
  the **pool rail** — one lamp per credential — visible from every page.
- **Color means state.** Green = serving / headroom, amber = low / cooling down, red = failing /
  exhausted, grey = disabled / unknown. Actions are ink (monochrome). `--focus` blue is the only
  accent: focus rings and text links. Provider brand colors only appear inside provider glyphs.

## Tokens (src/styles/themes.scss)

Use the primitives in new code; legacy `--bg-*`/`--text-*`/`--border-*` are aliases.

| Token | Use |
|---|---|
| `--rack` | page canvas, sidebar |
| `--panel` / `--panel-hover` / `--panel-raised` | panels & tables / hovered rows, quiet fills / popovers, menus, toasts |
| `--well` / `--well-strong` | inputs, code, meter tracks / count pills, icon tiles |
| `--ink` `--ink-2` `--ink-3` `--ink-4` | primary / secondary / metadata (≥4.5:1) / disabled, placeholders, em dash, separators only |
| `--rule` / `--rule-strong` / `--rule-ink` | hairline / control border / hover border |
| `--signal-{ok,warn,fault,idle}` + `-soft` + `-ink` | lamps & meter fills / tinted backgrounds / text on tinted backgrounds |
| `--focus`, `--focus-ring` | focus + links |
| `--shadow-float`, `--shadow-overlay`, `--scrim` | popovers / modals & sheets / modal backdrop |
| `--font-sans` (IBM Plex Sans), `--font-mono` (IBM Plex Mono) | UI text / identifiers, keys, filenames, logs, numbers in tables |

Never hardcode hex in modules. Dark theme is a token swap — if a module needs a
`[data-theme='dark']` override, the token is missing.

## Depth

Borders-only. Panels = `1px solid var(--rule)` on `--panel`, **no shadow**. Shadows exist only on
floating layers (menus, popovers, toasts → `--shadow-float`; modals, sheets → `--shadow-overlay`).
Sidebar shares `--rack` with the page and is separated by a single `--rule`.

## Type (SCSS vars in variables.scss)

Body 14px, controls 13px, ratio ≈1.2. Hierarchy via weight + ink level before size.

| Role | Size / weight / color |
|---|---|
| Page title | 18px (`$text-xl`) / 600 / `--ink`, letter-spacing -0.01em |
| Panel title | 15px (`$text-lg`) / 600 / `--ink` |
| Body, controls, table cells | 13px (`$text-md`) / 400–500 |
| Metadata, table headers | 12px (`$text-sm`) / 400–500 / `--ink-3` |
| Overline (`.overline`) | 11px / 500 / uppercase / 0.06em / `--ink-3` |
| Hero figure | 24–32px / 600 / tabular-nums |

Mono (`$font-mono`) only for machine strings: filenames, keys, model ids, paths, log lines,
timestamps in tables. Not for labels or prose. All changing numbers get `font-variant-numeric: tabular-nums`.

## Spacing & sizing

4px grid. Panel padding 16px (dense lists 12px). Gap between panels 16px; between page sections 24px.
Controls: 32px (`$control-md`), compact 28px (`$control-sm`), mobile primary 36–40px.
Table/list rows: 44px min (40 dense). Page gutter 24px desktop / 16px mobile. Content max-width 1440px.

Radius: 4px badges/pills · 6px controls/buttons/inputs · 8px panels/cards · 12px modals/sheets.

## Components

- **Buttons** (`<Button>` from `@/components/ui/Button`): `primary` = ink fill (one per view),
  `secondary` = panel + `--rule-strong`, `ghost` = text only, `danger` = fault fill (confirmations only).
  Icon-only buttons: 28–32px square ghost with `title` + `aria-label`.
- **Page header** (`<PageHeader>` from `@/components/common/PageHeader`): title, optional meta line
  (counts / status, 12px ink-3), right-aligned actions, optional `tabs` row below. Every top-level page uses it.
- **Status lamp** (`<StatusLamp>` from `@/components/ui/StatusLamp`): 8px dot, `ok|warn|fault|idle`,
  optional pulse for live. Use instead of colored pills for state.
- **Meter** (`<Meter>` from `@/components/ui/Meter`): 4px track on `--well-strong`. ONE tone rule
  everywhere — `toneForRemaining()` in `@/components/ui/meterTone`: healthy = neutral (`--ink-3`),
  <25% = warn, 0 = fault, unknown = idle. Never color healthy capacity green.
- **Lamp state** of a credential comes only from `getCredentialLampState()` (`components/layout/poolRail.ts`):
  ok = serving, warn = routing cooldown, fault = failing/unavailable, idle = disabled. Same lamp on every
  page; capacity is shown by meters/figures, not by changing the lamp. Lamp rows order ok → warn → fault → idle.
- **Tabs**: underline tabs, 13px/500, ink-3 → ink active with 2px ink underline; counts in mono ink-3.
- **Segmented control**: `--well` track, active segment `--panel` + `--rule-strong` hairline.
- **Badges/pills**: 20–22px tall, 4px radius, soft signal fills. No outlined pills.
- **Empty state**: quiet panel, small icon tile, one line of guidance, one action. Never dashed.
- **Errors**: inline, `--signal-fault-ink` text on `--signal-fault-soft`, with a retry action;
  never a full-width red slab that outweighs the data.
- **Tables / lists over card grids** for collections of similar records (credentials, keys, rules).
  Row hover = `--panel-hover`. Row actions: 1–2 visible, the rest in an overflow menu.

## Motion

Fast and quiet. Hover/press 120–140ms, popovers 160ms, modals 200ms, ease `--ease-out-strong`.
Press = `scale(0.97)`. Only animate transform/opacity. No page-transition choreography: route changes
are instant (opacity fade ≤120ms at most). Respect `prefers-reduced-motion`.

## Copy

Short, literal, operator voice. "Refresh", not "Click here to refresh quota". Counts as
`5 credentials · 4 serving`. Unknown values render as an em dash `—` in `--ink-4`, not "Not reported"
repeated in every field.

## Patterns in use (recorded after the redesign)

- **Shell** — sidebar 232px / 56px collapsed (⌘B, persisted in `cpa.sidebarCollapsed`), groups "Pool"
  (Overview, Credentials, Quota, Add account) and "Service" (Logs, Configuration, About). Footer:
  pool rail (8×14px lamp bars, worst-first) → connection line (lamp + host mono + version) →
  controls (theme segmented auto/light/dark, language, refresh, sign out with confirmation).
  Mobile: 52px sticky bar (menu, brand, pool fraction), drawer sidebar; the document is the only scroller.
- **Page** — `PageHeader` (18px/600 title, 12px ink-3 meta with `MetaDot`, actions right, underline tabs
  below). Content max-width 1440px, gutter 32/24/16px. `.main-content` uses `overflow-x: clip` so sticky works.
- **Data table** (Credentials, Overview providers) — 44px rows (36 compact), lamp · glyph · primary
  text + one secondary status line in signal ink · numeric cells tabular · switch · ⋯ row menu.
  Selection turns the toolbar into a contextual bar ("N selected · Select all M matching · Clear | actions").
- **Quota card** — status lamp + account + freshness; hero = remaining % of the tightest gating window
  (28px), subline "window · resets in"; one-line window rows (label · 4px meter · % · countdown);
  footer only when it has content. Healthy meters are neutral; warn <25%, fault at 0.
- **Settings row** (Configuration) — label 13/500 + YAML key 11px mono ink-4 + description ≤60ch on
  the left, control on the right at fixed widths; unsaved = 2px warn left edge, error = fault edge.
  Sticky section index on the left; sticky save bar only when dirty (Discard · Review & save ⌘S).
- **Log surface** — `--well` panel, 12px mono, 20px rows, CSS grid columns; level/status as colored
  text only, 5xx rows tinted fault-soft; detail views open in a right `Sheet`.
- **Overlays** — menus/popovers `--panel-raised` + `--shadow-float`, 140–160ms; modals 12px radius,
  200ms; sheets slide 260ms in / 180ms out; toasts bottom-right (bottom sheet-style on mobile).
