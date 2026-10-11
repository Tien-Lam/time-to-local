# Web development

Time to Local is a TypeScript web app in `web/`. Native sources and tooling have been removed at the user's request; historical commits and standalone conversion fixtures remain. Use the tool versions in `mise.toml`; dependencies and CLI tools are project-local and locked by `bun.lock`.

```bash
mise install
bun install --frozen-lockfile
bun run dev
```

Build and exercise the real offline app:

```bash
bun run check
bun run format:check
bunx --bun playwright install chromium firefox webkit
bun run test:browser
bun run preview
```

Preview is served on `http://127.0.0.1:4173`. Service workers require HTTPS or a loopback origin. Opening `index.html` from the filesystem or a phone pointing to an ordinary HTTP LAN address does not enable offline installation. Deployment is a static copy of `dist/`; no Bun/Node conversion server runs in production.

For a project subpath, set the same base for build and preview:

```bash
BASE_PATH=/ChronoShift/ bun run build
BASE_PATH=/ChronoShift/ bun run preview
```

`BASE_PATH` is `/` or a path with a trailing slash. Never serve a build at a different base. The manifest, navigation fallback, worker URLs and cache scope all share it. The generated service worker version includes every asset and the worker template. Keep `sw.js`, HTML and the manifest revalidated; hashed assets may have immutable caching. Serve JavaScript, CSS and the manifest with correct MIME types, use HTTPS, and enable gzip/Brotli on the host.

The preview server sets a restrictive CSP and avoids request/body logging. Cloudflare Workers Static Assets serves the production bundle with generated `_headers`: response-level CSP including `frame-ancestors`, no-referrer, nosniff and frame denial. Hashed assets have immutable caching; HTML, manifests, release metadata and the service worker use Cloudflare's revalidation default. The HTML CSP meta tag remains for offline shells. `_headers` and `_redirects` are host configuration and are excluded from the worker precache. Missing assets return 404 rather than an HTML fallback. No runtime Worker script, request logging, analytics or conversion backend is configured. Verify headers on the live URL.

The converter's waiting-update prompt sits before the workspace so conversion
results, warnings and clipboard feedback cannot move its button during a press.
Draft-preservation failure appears immediately below the prompt, including on
About. Update activation still requires a completed deliberate press; a failed
preservation leaves the message and waiting update available for recovery.
The first installation cannot offer itself as an update: an installed candidate
must replace a different active or controlling worker before the prompt appears.

The production build embeds the small initial stylesheet into HTML to avoid a
render-blocking CSS request. Both response and offline-shell CSP permit its exact
SHA-256 hash; the preview reads that generated response policy from `_headers`.
Static style attributes permit only the exact hashes of React Aria's hidden
select geometry and the initially hidden result shortcut, scoped to
`style-src-attr`. Arbitrary inline styles and scripts remain blocked.
The original hashed CSS remains in the integrity precache. Date controls load
when Message interpretation first opens and stay mounted after closing so partial date
edits and validation survive. Their styles are included initially, and a failed
code request exposes a retry without replacing the converter or its draft.
Loading, failure and retry reserve the date field's height so format controls
and their open menus remain stationary when the code finishes loading.
The lazy JavaScript is precached before offline readiness is confirmed.
Timezone suggestion collections initially contain only the selected item, so the
first arrow-key opening retains its focus. Each field's full collection is populated
on first opening and retained thereafter, including while its popup exits. Saved and
typed values remain independently controlled.
Pages and conversion workers use the browser's complete native Temporal API when
available, otherwise loading the pinned compatibility implementation. The fallback
chunk remains in the integrity-verified offline cache. Conversion and formatting
use the same implementation within each context, preserving the independent
temporal expectations for both paths.
The conversion worker installs its message handler before loading the engine,
so the first request is retained while the fallback loads. An import rejection
returns a readable error; editing the retained message creates a fresh worker and
retries. Canceling or superseding a conversion still terminates its worker.
Measure the complete entry import graph when comparing startup payload; smaller
initial downloads do not establish a particular Lighthouse score. Recheck both
mobile and desktop with PageSpeed Insights after authorized publication.

## Search discoverability

The build renders the initial converter interface, introduction and usage guide
into static HTML. React hydrates the existing elements instead of replacing them,
so the introduction can paint before the application JavaScript arrives. The
workspace and appearance controls remain inert while loading; saved preferences,
the device timezone and the About route are restored before editing is enabled.
The static shell labels its unknown timezone explicitly and contains no user
input. Without JavaScript, the introduction and guide remain readable and a
notice explains that conversion requires JavaScript. Rendering happens at build
time; no conversion server is added. Development uses the usual client render.

`web/src/site.ts` owns the production URL, description and WebSite name data.
`scripts/search-metadata.ts` writes a canonical link, matching Open Graph metadata,
and JSON-LD; the CSP permits only that JSON-LD's exact hash. Both the production
root and `/ChronoShift/` regression build identify `https://timetolocal.com/` as
canonical. The sitemap lists only the public homepage: About uses a fragment,
and conversion text never becomes a URL or search metadata.

The build generates `robots.txt` and `sitemap.xml`. They are discovery files,
excluded from the offline precache so crawler resources cannot block offline
readiness. Preview serves them with text and XML MIME types. Check the published
files after deployment. Use [PageSpeed Insights](https://pagespeed.web.dev/) for
performance, [Rich Results Test](https://search.google.com/test/rich-results) for
supported rich-result data, and [Search Console](https://search.google.com/search-console)
for verified-property URL Inspection and sitemap submission. WebSite name data
does not itself establish eligibility for a software-app rich result or confirm
indexing. Google's [SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)
describes the underlying recommendations.

## Cloudflare publishing

The Cloudflare Worker is named `time-to-local`, renamed in place from
`chronoshift` through the Workers API using immutable Worker ID
`ae31f2a91482499cbee3eceb72a4336f`. Its deployment history and custom-domain
bindings remain attached to that service. Browser storage keys, cache prefix
and internal test/build environment variables retain their existing values. These
are compatibility identifiers: keeping them preserves installed-app identity,
saved preferences, pending handoffs and opt-in updates from the former branding.
The manifest ID, start URL and service-worker scope remain `/`. The
`/ChronoShift/` regression path and historical evidence links remain unchanged.
Current GitHub operations use `Tien-Lam/time-to-local`.

Rename an existing Worker through
[`PATCH /accounts/{account_id}/workers/workers/{worker_id}`](https://developers.cloudflare.com/api/resources/workers/subresources/workers/methods/edit/)
with only its new `name`; changing Wrangler's name alone can create a second
Worker. Verify the immutable ID, domain/certificate IDs and deployment history
before publishing with the updated configuration. The zone redirect rule uses the Time to Local description. Cloudflare keeps
the phase entry-point ruleset name and the existing rule reference immutable,
so `ChronoShift canonical redirects` and `chronoshift_www_canonical` remain;
the existing rule ID is retained.

The site is https://timetolocal.com/, owned by the repository owner. Cloudflare publishes only main through `.github/workflows/publish.yml`. Ready same-repository PRs run the full production browser and repository-subpath gate and retain the tested root artifact for one day; PRs have no deployment job. Drafts defer automatic hosted verification; [explicit investigation requests and final-gate instructions](testing.md#ci-efficiency) retain full coverage. A deferred check is not a verified release. On main, scripts/reuse-site-artifact.ts accepts only a successful trusted Web PR run with every required check, identical head/tested-release/main trees, the GitHub artifact digest and safe archive paths. Main uploads those exact tested files as a fourteen-day rollback artifact. Missing, expired or unverifiable evidence runs the full reusable Web gate. Manual publication always runs the full gate. The complete publishing workflow is serialized, protecting active deployments from cancellation and preventing a slower older verification from overwriting a newer publication. Documentation/design/evidence-only pushes skip both workflows. Unexpected failed browser attempts retain diagnostics for three days even when a retry passes. The cloudflare-production environment permits only main. `CLOUDFLARE_API_TOKEN` is stored as a GitHub Actions secret, scoped to Workers deployment in the intended account and Workers Routes write for the domain zone. `wrangler.jsonc` declares the account, domains and static-only routing. Native maintenance is retired; physical web acceptance remains open.

`release.json` identifies the source commit and base path. It participates in the cache version, making releases reproducible and observable. After deployment, run `bun run test:hosted`; optionally set `HOSTED_EXPECTED_COMMIT` to the full deployed SHA. Checks cover HTTPS assets/MIME, effective meta CSP, manifest/scope, local-only requests and new conversion after an offline close/reopen.

The `www` canonical redirect is a zone-level Single Redirect in the
`http_request_dynamic_redirect` phase, using
[`deployment/www-redirect.json`](../../deployment/www-redirect.json). Apply this
rule through the Cloudflare API/MCP or dashboard, preserving other rules in that
phase. It keeps the path and query string and returns 301 to the HTTPS apex.
Workers `_redirects` cannot match hostnames. This zone configuration is separate
from routine Wrangler publication; the CI token does not need redirect-rule edit
permissions. Both hostnames are declared as Worker Custom Domains for DNS/TLS.

For rollback, select a successful main **Publish site** run after the Worker rename at the desired source SHA, then `gh run rerun RUN_ID --repo Tien-Lam/time-to-local`. The workflow rebuilds the pinned source and replaces the site; the release file/cache version returns to that source. Do not rerun a pre-rename publication: its historical configuration targets `chronoshift`. For a pre-rename release, use the retained Cloudflare version on the existing `time-to-local` Worker, with `bunx wrangler rollback VERSION_ID --name time-to-local`; coordinate it with the serialized publication workflow so a pending deployment cannot overwrite the rollback. Re-running a deployment does not revert Git branches. Verify the live release file and hosted checks, then ask an existing client to check for an update and choose **Update now**. Users with old tabs continue on their cached release until opting in. A server rollback cannot forcibly revoke an installed offline version. To restore the latest release, re-run its successful post-rename publishing run. Superseded verification jobs on the same branch or PR are canceled. The complete workflow shares the `site-publication` concurrency group and is never canceled while active; GitHub keeps at most one pending deployment. Manual reruns remain available for rollback.

Historical migration-branch publishing runs no longer have deployment permission after main-only cutover; restore historical source through a reviewed main change when needed.

For a reproducible existing-client proof, run `bun scripts/verify-hosted-rollout.ts COMMAND_JSON REPORT_JSON` against the initial deployment. Keep it running while deploying the next version, rolling back using the applicable post-rename run or retained Cloudflare version above, and restoring the new run. After each deployment, write `{ "stage": "update" | "rollback" | "restore", "sourceCommit": "FULL_SHA" }` to COMMAND_JSON. The probe requires a waiting update, checks that the old page stays active until opt-in, verifies draft preservation, and closes/reopens offline to convert a fresh message after every transition. It writes a report only after actual assertions pass.

## Architecture

- `engine/parser.ts`: pinned Chrono English parsers with bounded military/shorthand/range extensions. No model download is required.
- `engine/convert.ts`: injected reference clock, context, source zones, DST disambiguation, Unix seconds and deduplication. Target changes only reformat results.
- `engine/time.ts`: bundled Temporal compatibility path plus browser Intl zone data; fixed offsets retain offset labels. Seconds and milliseconds are retained when present.
- `engine/worker.ts`: a disposable worker per conversion with request IDs. Draft and conversion-setting edits invalidate pending work synchronously; conversion starts automatically after a 250ms debounce, waits for IME composition to finish and recovers on the next edit. Import conflicts use a separate user-interaction version.
- `App.tsx`: responsive accessible form/results, target/city lookup, clipboard and recovery paths.
- `platform/`: versioned preference-only storage, service-worker readiness and short-lived share/update handoffs.
- `sw-template.js` + `scripts/build-offline.ts`: atomic precache, cache-only supported navigation, explicit update activation and offline POST share interception.

Only preferences persist by default. Conversion text stays in memory. A user-accepted update temporarily places the draft in session storage; POST share reception temporarily places text in IndexedDB. Both are single-use and refuse payloads older than five minutes. Abandoned entries are deleted on the next launch/share; a closed browser cannot run a physical erasure timer. Clearing site data removes them immediately. Shared URLs are displayed as text and never fetched. Shares are intercepted locally while the service worker is registered; after clearing site data, reopen the app and restore offline readiness before sharing again. Installation/share-menu availability depends on the actual browser; paste always works.

Old tabs may still need their own hashed worker. Cache cleanup retains older versions while multiple tabs are open and retains one previous version with a single tab. An update never reloads a tab without its Update action. Cache repair stages verified bytes from the controller's own release cache and fetches only missing or corrupt assets, requiring their exact release hashes. A newer deployment may retire older hashed assets and replace mutable documents. Reusing intact cached files avoids unnecessary failed downloads, but a missing old document may still require choosing the waiting **Update now** action. Waiting updates remain visible through readiness failures and timeouts. Failed staging preserves intact existing assets and removes only its temporary cache. Runtime dependency notices are generated into third-party-notices.txt at build time. Rebuilding the previous source produces a different service-worker version from the later release and is the rollback candidate; verify it on the chosen HTTPS origin before release.

### Detailed console diagnostics

Open **Adjust interpretation & format → Enable detailed logs** before reproducing a problem. Logging is off by default; the explicit opt-in lasts for the current tab session, including reloads and accepted updates. It works in memory if session storage is denied. Uncheck it or reset preferences to stop future logs. Previously printed console entries remain until the browser clears them.

`[Time to Local]` console entries record timestamps, field focus/open events, conversion duration/counts, registration attempts, installation states, readiness probe reasons/durations, controller cache version and update availability. The current worker additionally reports missing/corrupt bundled asset paths and bounded repair counts/failure categories. Older installed workers can report only their existing protocol fields until an explicit update is accepted; absent repair details are unknown. Message text, parsed dates/locations, selected zones, clipboard/share content and URL queries are excluded. No diagnostic event history or telemetry is stored or sent; session storage contains only the opt-in flag. Browser-generated errors and the installation-banner notice are independent of this logger.

To investigate a warning, compare `ui.zone-focus`/`ui.zone-open` timestamps with `offline.probe-start`, `offline.probe-result` and `offline.state`. Record the cache version, probe reason/duration, unavailable asset paths, repair failure and whether an update is available. Distinguish a natural warning from a deliberately injected missing cache or network response. Healthy fresh sessions cannot reconstruct an affected older client's cache history.

`CHRONOSHIFT_TEST_SERVER=1` enables preview-only release fixtures in `scripts/test-releases.ts`. They rename every JS/CSS asset, rewrite HTML/worker/precache references and require matching worker message protocols. Each multi-release scenario uses a dedicated origin with an explicit test-only publish control, avoiding dependence on cookies in browser-internal service-worker update requests. Multi-tab tests reject a deliberately mixed worker, then prove lazy workers for releases N, N+1 and N+2 still convert offline without reloading old pages. A single-tab rollback proves draft/theme preservation, single-use draft removal and obsolete-cache cleanup. These fixtures never run on Cloudflare or enter the production bundle. Resetting all preferences removes the saved preference record instead of recreating a default record.

## Verification and evidence

`tests/fixtures/temporal.json` has independently specified instant/date expectations. Unit checks use the real parser; browser checks run the same fixtures in the built worker. `tests/fixtures/resilience-corpus.json` preserves 353 historical inputs and metadata as standalone web data, with immutable Git provenance. Maintain it directly; resilience/count comparisons are an inventory, not an accuracy oracle.

```bash
bun run corpus:audit
bun scripts/benchmark-web.ts
```

CI runs formatting, type checks, real-engine tests, the frozen production build and all browser scenarios. Chromium/Firefox use network-offline emulation. WebKit uses a stopped dedicated origin plus a negative uncached-network check because of [Playwright issue 42775](https://github.com/microsoft/playwright/issues/42775); it does not skip offline tests.

Physical acceptance remains separate from the user-authorized engineering merge. Record real Android Chrome/iOS Safari and desktop Chrome/Edge/Firefox/Safari versions; offline reopen with fresh input; installed share where supported; actual screen-reader/task checks; phone startup and p95 conversions; host headers and N→N+1→rollback. Emulation and desktop benchmarks cannot close those gates. Dependency maintenance targets Bun and GitHub Actions. Bun's text lockfile is supported by [Dependabot's Bun ecosystem](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference).

Offline navigation uses the final CSP-bearing HTML embedded in the generated
worker. Installation and repair verify that shell against the same release's
SHA-256 before caching it as `index.html`. They do not fetch mutable HTML:
network content filters can inject scripts or change CSP, and the host may already
serve a newer document. All other runtime assets still require exact integrity.
