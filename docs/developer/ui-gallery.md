# Owned UI recipes and local regression gallery

Time to Local adopts actual local shadcn/ui React Aria recipes, with the approved
warm Light/forest Dark identity. The portable selection and review workflow is
[ui-quality.md](ui-quality.md); project decisions and every earlier issue mapping
are in [ui-adoption.md](ui-adoption.md). These owned recipes are production code,
not an installed package or inspiration-only wrapper.

## Source, licence and upgrades

Audited 7 October 2026 against the official [React Aria Button documentation](https://ui.shadcn.com/docs/components/aria/button).
The upstream repository is `shadcn-ui/ui`, immutable revision
`e8c3143b1cd191280befcd6c9538284bb43399a8`. Its actual recipe sources are
[`apps/v4/registry/bases/aria/ui/`](https://github.com/shadcn-ui/ui/tree/e8c3143b1cd191280befcd6c9538284bb43399a8/apps/v4/registry/bases/aria/ui):
`button.tsx`, `input.tsx`, `collapsible.tsx`, and `popover.tsx`. Exact acquired
sources are retained as provenance in `docs/vendor/shadcn/*.tsx.txt`; MIT copyright
and permissions are in `docs/licenses/shadcn-ui.LICENSE` and the emitted offline
`third-party-notices.txt`.

| Actual source → owned component               | Retained recipe contract                                                                          | Local adaptation                                                                                                                                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Button → `components/ui/ActionButton.tsx`     | React Aria Button props/ref, owned cva variants, data-slot/data-variant, one primitive activation | Quiet/primary/outline/iconAction replace default/ghost/size catalogue; 44px targets and approved tokens; no broad transition-all, outline removal or arbitrary polymorphism. The API excludes onClick; operations remain in App. |
| Input → `components/ui/Input.tsx`             | React Aria Input, composeRenderProps, data-slot, caller props                                     | Existing CSS and label/help/invalid semantics replace utility classes. Production ZoneChoice uses it.                                                                                                                            |
| Collapsible → `components/ui/Collapsible.tsx` | Disclosure/trigger-slot/DisclosurePanel composition and controlled expansion                      | Domain Disclosure keeps immediate hidden/inert/aria-hidden close geometry and approved decoration; no height interpolation.                                                                                                      |
| Popover → `components/ui/Popover.tsx`         | React Aria Popover, placement/offset/crossOffset, data-slot and caller props                      | Content-sized existing menu/calendar surfaces, 8px offset; ResizeSafePopover retains bounded layout-resize anchoring. No fixed upstream 18rem width or anchored entrance transform.                                              |

Versions: React Aria Components 1.21.1, React/React DOM 19.3.0 and
class-variance-authority 0.7.1; full transitive graph is frozen in bun.lock.
Acquire/audit future upstream revisions through `gh api`, inspect the diff against
these snapshots, reapply the explicit adaptations, preserve licence, then run
independent geometry/content/input/lifecycle checks and review candidate goldens.
Never run an unreviewed latest CLI migration over owned sources.

## Styling, interaction ownership and exceptions

The source recipes use `cva` and utility classes. We retain cva's variant API and
translate the utility/default style layer to existing plain CSS. Tailwind, its
Preflight, `cn` package, animation plugins, icon packages and runtime CDN are not
required. Vite emits local hashed JS/CSS/font assets. The normal offline build
continues to precache only production assets beneath the configured base path;
`verify-ui-build.ts` rejects gallery/fault strings in emitted assets.

A quiet control owns symmetric logical 12px inline/10px block padding, centered
inline-flex content, 8px gap and at least 44px block size. Adjacent spacing belongs
to its parent. Primary keeps the reserved Copy width and contrasting press pair.
Outline shares control borders; iconAction is a 44px square with a required
accessible name from its caller. Variant CSS preserves immediate focus and finite
approved motion. It does not decide domain wording, outcomes or clipboard state.

In the message tools, Paste uses the outline variant to emphasize importing the
user's message. Random example is a muted quiet action, and Clear remains quiet.

React Aria owns gesture state (`data-pressed`) for migrated ActionButton and
CollapsibleTrigger. The existing delegated early-touch hook explicitly excludes
these slots; it still serves native summaries/links and specialized date/list
controls. No competing onClick or new local touch state is installed. Native
CDP touch tests sample early palette feedback and stationary geometry, then
release/cancel/drag and check exactly one activation. The pre-existing independent
touch palette/geometry suite retains its expectations with an attribute-owner
helper. Removing the remaining delegated scope requires equivalent native tests.

DateChoice remains a specialized DatePicker with segmented editing, incomplete
validity, reset, calendar focus and locale semantics. ChoiceSelect/ZoneChoice keep
their Select/ComboBox triggers, filtering, typed-vs-selected-vs-focused distinction
and hover/Tab behavior, sharing the adopted Input and Popover shell. Native
editor/manual-copy textareas keep caret, selection, IME and context menus; native
diagnostic checkbox keeps browser semantics. Appearance/examples summaries keep
existing details dismissal/retained-close behavior. These are explicit bounded
migration exceptions, not claims of adopting every shadcn recipe.

## Development-only gallery

Run `bun install --frozen-lockfile`, then `bun run dev:gallery` and visit
`http://127.0.0.1:44101/__gallery/`. `?theme=light` selects the other palette;
`?design=aqua&theme=light` previews classic Aqua controls. Workspace views use
the real app's saved appearance preference and Appearance selector.
`?view=workspace` renders the actual App; its fixtures are entered through the
real editor in Playwright, using independently specified expected times/labels.
The gallery includes quiet/primary/outline/icon, text and icons, long/adjacent
labels, disabled/pending/success/error, fields/help/invalid input, disclosure,
search/date/menu/calendar compositions. Actual hover/keyboard focus/mouse press
and native touch are driven by tests, not fabricated CSS state props.

The Aqua-only `dev/AquaCatalog.tsx` extends those fixtures with the owned native
Checkbox and StatusIndicator, actual searchbox semantics, invalid/disabled fields,
editor/manual-copy textareas, disabled gel/pearl and pending pearl actions, all seven
status states, and labeled update/import/install material samples. Switch to
`?design=aqua&theme=dark` for the navy adaptation. Support samples are explicitly
local examples; they do not certify update/import/install lifecycles. The real
workspace and production suites remain those behavior owners. Aqua material and
part contracts are documented in [appearance.md](appearance.md#owned-aqua-component-library).

A Vite `apply: serve` middleware creates this HTML route. Production main.tsx has
no gallery import, production HTML has no gallery entry and public assets contain
no gallery. No hosted account or visual service is used. This dev route is not an
offline/PWA acceptance environment: ordinary production lifecycle suites continue
to exercise the built app and real service workers independently.

## Independent checks and reviewed visuals

`bun run test:gallery gallery.spec.ts` runs independent label/surface center and
44px geometry, genuine pointer/focus/press/disabled/pending/outcome journeys,
accessible icon/field content, native early touch cancellation/release/drag and
real App hierarchy/range/precision/resize checks at 280/390/960px. Development-only
`?fault=paste` restores the predecessor's one-sided padding, which must violate
the <=1px label-center contract; `?fault=name` removes the icon name, which must
violate the accessible-name expectation. `?fault=outcome` reports success after the local rejected-operation example, which the independent expected error message rejects. Fault controls never ship.

`bun run gallery:candidates` writes PNGs and environment.json exclusively beneath
ignored `.work/TIE-390/visual-candidates/`. This is candidate capture, not a visual
approval. A reviewer inspects every intended change, records revision and verdict,
then explicitly copies approved PNGs plus environment.json to
`e2e/gallery/goldens/`. `bun run test:gallery` compares exactly against those
reviewed files. Missing baselines fail; updateSnapshots is forbidden even if
requested on the CLI. Baseline/browser/OS/architecture/font/version mismatch fails
before pixel comparison. There is no automatic golden acceptance.

Environment pins include Playwright/browser version, OS release/architecture,
Geist SHA-256, DPR 1, en-AU, Australia/Sydney, 900px height, supported widths,
reduced motion and dark system preference. Explicit palette is part of each case.
Deterministic screenshots disable animations only for the capture; native
input/normal-motion journeys are separate tests. Screenshots cannot establish
interrupted motion or truthful clipboard completion.

Preserve existing exact parser/result/copy fixtures and lifecycle suites:
`result-labels`, `options`, `controls`, `copy-focus`, `imports`, `tap-feedback`,
`redesign-motion`, `motion`, `responsive`, `privacy`, `updates`, offline and
subpath checks. These cover the remaining adoption rows; library adoption and
static screenshot comparisons do not replace them. Human review still owns
usefulness of source/reference explanations, approved hierarchy and palette.
Browser emulation does not establish a phone, OS screen reader or phone
performance result. Existing CSS zoom evidence is CSS zoom, not actual browser
zoom; keep any unverified browser-zoom acceptance gap explicit.

## Actual browser zoom

The production `browser-zoom.spec.ts` uses a fresh owned persistent profile in
full bundled Chromium (`channel: chromium`, new headless mode), with the browser's
`partition.default_zoom_level` preference set for the default storage partition
key `x`. The [official Chromium implementation](https://github.com/chromium/chromium/blob/59acba6a99d42807886e27609fea33ccd91f3285/chrome/browser/ui/zoom/chrome_zoom_level_prefs.cc)
was inspected before using this method. The level is `log(factor)/log(1.2)`.
A paired 100% control asserts outer/inner width 1000/1000, DPR 1. The 200% run
asserts physical outer widths 560/780/1920 and layout widths 280/390/960, DPR 2,
visualViewport scale 1 and computed CSS zoom 1, then resizes the actual browser
window through CDP while retaining the draft, intact precision and Copy geometry.
No device-scale, page-scale, CSS zoom or viewport override substitutes for browser
zoom. The default headless shell did not apply these Chrome profile preferences;
that failed capability probe is not accepted as zoom evidence. Both approved palettes are exercised while the actual browser zoom remains active. This supports
Chromium browser zoom; other engines and physical browser UI remain separate.

The disclosure retains the native predecessor's focused-child correction for programmatic/virtual trigger activation before collapse. The gallery checks focus returns to the trigger, panel controls become hidden/inert immediately and keyboard reopening restores the panel.
