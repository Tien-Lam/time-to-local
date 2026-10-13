# Time to Local

Formerly ChronoShift. The repository is [Tien-Lam/time-to-local](https://github.com/Tien-Lam/time-to-local).

[Open Time to Local](https://timetolocal.com/) — a private timezone converter that works offline after its first complete online load.

Paste or type a message and choose your destination timezone. Results convert automatically as you type; copy them with their date and zone. Time to Local handles natural-language dates/times, cities, explicit offsets and IANA zones, ranges, Unix seconds and labeled ambiguity. **Try example** starts with a fully specified conversion. **Message interpretation** controls the fallback source, reference date and date order in messages; contextual result actions open the relevant field. **Display preferences** controls the clock format separately, and support diagnostics remain optional.

Ambiguous messages show a warning before the alternatives and Copy actions. Numeric dates disclose the calendar date and date order used, including when an impossible month makes the order unambiguous or an equivalent spelled-out mention shares the result. Unambiguous ranges share one result card with **Copy range**; ambiguous endpoints stay separate choices. Human-readable source and reference summaries retain expandable interpretation details and the original message excerpt.

Timezone-first phrases work too: `pdt now, cst midnight`, `JST noon`, `PDT tomorrow midnight`, `UTC+05:45 3pm` and `America/New_York now`. Keep separate phrases separated by commas, semicolons or newlines. CST retains its US Central and China interpretations. “Now” keeps the current instant; an undated midnight means 00:00 on the displayed source reference date. Use “tomorrow midnight” or an explicit date when you mean a different day.

The layout adapts to phones, tablets, desktop windows and foldable displays. Supported browsers place input and results clear of a hinge. Conversion runs entirely on your device with no account, conversion server or mandatory model download.

Use **Appearance** in the header to choose **Dark**, **Light** or **System**. One adaptive workspace pairs a warm paper/clay Light palette with a forest/lime Dark palette and local typography. Dark is the default; System follows your device. Theme changes keep your current message and results, and preferences are saved locally. Motion respects your reduced-motion preference. See [appearance behavior](docs/developer/appearance.md).

## Use offline

Open the app online once and let it finish loading before disconnecting. Offline setup problems appear only when action is needed. Install it from your browser's menu if offered, or bookmark it. Clearing browser storage requires another complete online visit. Updates wait for **Update now** and preserve your current message when accepted.

Only preferences persist by default. Conversion text stays in memory; explicit updates and supported installed-app shares use a short-lived, single-use local handoff. Ordinary paste works across supported browsers.

## Develop

Use the project-pinned runtimes managed by mise:

```bash
mise install
bun install --frozen-lockfile
bun run dev
```

Build and run the real offline app:

```bash
bun run check
bun run format:check
bun run preview
```

Open http://127.0.0.1:4173 and let it finish loading. Offline caching is enabled in production builds. The development server provides live reload.

## Verify and publish

```bash
bunx --bun playwright install chromium firefox webkit
bun run test:browser
bun run corpus:audit
bun run test:hosted
```

Cloudflare Workers Static Assets publishes verified builds at `https://timetolocal.com/`. GitHub Actions runs the complete web gate and publishes only `main`; trusted PR artifacts are reused only after exact source-tree and digest verification. No conversion backend or application server runs in production.

See [build setup](docs/developer/building.md), [tests](docs/developer/testing.md), [publishing and rollback](docs/developer/web.md), [browser acceptance](docs/developer/device-smoke-test.md) and [the conversion pipeline](docs/architecture/nlp-pipeline.md). Work and acceptance evidence are tracked in [GitHub Issues](https://github.com/Tien-Lam/time-to-local/issues) and [GitHub Projects](https://github.com/users/Tien-Lam/projects/1); see [the contribution workflow](docs/GITHUB_WORKFLOW.md).

Time to Local is maintained as a web app. The native application and its maintenance tooling have been removed; previous versions remain in Git history.

## License

MIT. Production dependency notices are bundled with every build.

## Documentation and workflow

Documentation stays in README.md and repository Markdown files, reviewed through GitHub Pull Requests. The [GitHub workflow](docs/GITHUB_WORKFLOW.md) names the products used for tracking, review, checks and releases; the existing [GitHub Wiki](https://github.com/Tien-Lam/time-to-local/wiki) links to canonical docs.
