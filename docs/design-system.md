# ShaderStudio design system

Modern minimal: calm neutrals, one accent, generous spacing, clear hierarchy, progressive disclosure.
Tokens live in `src/index.css`; primitives in `src/components/ui` (import from `@/components/ui`).
Dark is default (`class="dark"` on `<html>`); light is `:root`.

## Tokens (Tailwind utilities)

| Group | Utilities | Notes |
|---|---|---|
| Surfaces | `bg-canvas` `bg-panel` `bg-raised` `bg-overlay` `bg-hover` `bg-active` | canvas = app/viewport bg, panel = sidebars, raised = inputs/cards, overlay = menus/modals |
| Border | `border-line` (subtle, default), `border-line-strong` | `*` already defaults to `border-line` |
| Text | `text-fg` `text-fg-muted` `text-fg-subtle` `text-fg-disabled` | primary / secondary / tertiary / disabled |
| Accent (one) | `bg-brand` `hover:bg-brand-hover` `text-brand-fg` `bg-brand-soft` `text-brand-text` | dark solid `#4d5fd6`, text `#8b9cff`; light `#4a5bd4` |
| Semantic | `text-success/warning/danger/info`, `bg-*-soft`, `bg-danger-solid` | muted; prefer Badge tones |
| Radius | `rounded-sm` 4, `rounded-md` 6 (controls), `rounded-lg` 10 (cards), `rounded-xl` 14 | |
| Shadow | `shadow-sm` `shadow-md` (menus) `shadow-lg` (modals) | subtle in dark |
| Focus | global `:focus-visible` 2px outline in `--ds-ring`; helper `focus-ring` | do not add ring classes to controls |
| Motion | `--ds-dur-fast/base/slow` = 120/180/280ms, `--ease-out-soft`; collapse under `prefers-reduced-motion` | default `transition` already uses fast + ease |
| Type | `text-2xs` 11/16, `text-xs` 12/18, `text-sm` 13/20 (body), `text-base` 14/22, `text-lg` 16/24, `text-xl` 20/28 | |
| Fonts | `font-sans` (Inter stack, no download), `font-mono` | mono only for code and numbers |
| Numbers | `num` (mono + tabular), `tabular` | every numeric readout |

Spacing is Tailwind's 4px base (`p-1` = 4px). Rhythm: 4/8/12/16/24; panel padding `px-3` (12), field gap `gap-3`, row height 28-32px.

### Compat aliases (do not use in new code)
`bg-background text-foreground bg-card bg-primary (=brand) bg-secondary bg-muted text-muted-foreground bg-accent bg-destructive border-border ring-ring` still resolve. W5: replace with the tokens above. Note `accent` is the neutral hover surface, NOT the brand colour (that is `brand`).

## Primitives

```tsx
<Button>Render</Button>   // variant: primary|secondary|ghost|outline|danger   size: sm(28)|md(32)|icon
<IconButton label="Settings"><Settings /></IconButton>   // aria-label + tooltip, 32px
<Input /> <Textarea /> <Select><option>..</option></Select>   // native, 32px
<Switch /> <Slider /> <Label>Name</Label>
<Segmented aria-label="Backend" value={b} onValueChange={setB}
  options={[{ value: "webgpu", label: "WebGPU" }, { value: "webgl2", label: "WebGL2" }]} />
<NumericField label="X" value={x} onChange={setX} step={0.01} min={0} max={1} unit="px" />  // drag label to scrub; Shift x10, Alt x0.1
<ColorField value="#ff8800" onChange={setC} />
<Tabs defaultValue="a"><TabsList><TabsTrigger value="a">A</TabsTrigger></TabsList><TabsContent value="a">..</TabsContent></Tabs>
<Panel><PanelHeader title="Inspector" actions={<Button size="sm">Add</Button>} />
  <Section title="Transform"><Field label="Scale">..</Field></Section>
  <Section title="Advanced" defaultOpen={false}>..</Section></Panel>
<Badge tone="success">Compiled</Badge> <Kbd>Ctrl</Kbd> <Separator /> <Tooltip label="Hint"><span /></Tooltip>
```

Hit targets are >= 28px. Sliders and numeric/color fields carry `nodrag nopan` for React Flow.

## Theme
`ThemeProvider` supports `light | dark | system` (`useTheme()` gives `theme`, `resolvedTheme`, `setTheme`) and reads localStorage synchronously on first render. For zero flash before the bundle loads, `index.html` needs the tiny inline snippet documented at the top of `src/components/theme-provider.tsx`. Today index.html hardcodes `class="dark"`: fine for dark users; light/system users see dark until React mounts.

## Do / Don't (W5)
- Do sentence-case titles (`Material settings`), `text-sm font-medium`. Do not use uppercase mono headings.
- Do one primary `Button` per panel; everything else secondary/ghost.
- Do show numbers in `num` (tabular mono); everything else in sans.
- Do hide advanced controls in a closed `Section`; do not show every control at once.
- Do use `border-line` plus surface levels for hierarchy; do not stack borders and shadows.
- Do use the type scale and 4px spacing; no `text-[10px]`, `p-[7px]`, ad-hoc hex colours.
- Do label icon-only buttons via `IconButton`; do not rely on colour alone for state.
- Do not add ring classes to controls; the global focus-visible outline handles it.
