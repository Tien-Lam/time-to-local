import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import type { Conversion, ConversionOptions, TimeResult } from "./engine/types";
import { MAX_INPUT } from "./engine/limits";
import { copyText } from "./engine/time";
import {
  copyRangeText,
  resultGroups,
  resultSummary,
} from "./engine/presentation";
import { ResultCard } from "./components/Results";
import { resolveCity, validZone, zoneName } from "./engine/zones";
import {
  DEFAULTS,
  deviceTimezone,
  loadPreferences,
  resetPreferences,
  savePreferences,
} from "./platform/preferences";
import {
  clearAbandonedShares,
  consumeShare,
  consumeUpdate,
  preserveForUpdate,
} from "./platform/handoff";
import { setupOffline } from "./platform/offline";
import type { OfflineState } from "./platform/offline";
import {
  diagnostic,
  detailedLogsEnabled,
  setDetailedLogs,
} from "./platform/diagnostics";
import { ChoiceSelect, ZoneChoice } from "./components/Choices";
import { DeferredDateChoice } from "./components/DeferredDateChoice";
import { ActionButton } from "./components/ui/ActionButton";
import { ControlIcon } from "./components/ui/ControlIcon";
import { Disclosure } from "./components/Disclosure";
import { About, GITHUB_URL } from "./components/About";
import { ConverterGuide, ConverterIntro } from "./components/ConverterGuide";
import { SITE_TITLE } from "./site";
import { PopoverVisibilityContext } from "./components/ResizeSafePopover";
import { useRetainedOpen } from "./components/useRetainedOpen";
import { useTouchFeedback } from "./components/useTouchFeedback";

const examples = [
  "April 9, 2026 3pm in Tokyo",
  "April 9, 2026 9am–11am UTC",
  "Tomorrow at 3pm in Tokyo",
];
const UPDATE_STORAGE_WARNING =
  "Copy your message somewhere safe, then clear it before updating. This browser cannot preserve it during a reload.";
function resolveZone(value: string, fallback: string): string | undefined {
  if (!value.trim()) return fallback;
  if (validZone(value.trim())) return value.trim();
  const cities = resolveCity(value).zones;
  return cities.length === 1 ? cities[0] : undefined;
}

export interface AppProps {
  booting?: boolean;
  base?: string;
}

export default function App({
  booting = false,
  base = import.meta.env.BASE_URL,
}: AppProps) {
  useTouchFeedback();
  const [initializing, setInitializing] = useState(booting);
  const [text, setText] = useState("");
  const [aboutOpen, setAboutOpen] = useState(
    () => !booting && location.hash === "#about",
  );
  const previousAbout = useRef(false);
  const [entering, setEntering] = useState(
    // Static panels start their CSS-only entrance with the HTML. Hydration
    // retains that presentation instead of hiding/restarting painted content.
    () => booting || !matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [prefs, setPrefs] = useState(() =>
    booting ? DEFAULTS : loadPreferences(),
  );
  const [device, setDevice] = useState(() =>
    booting ? "UTC" : deviceTimezone(),
  );
  const [referenceDate, setReferenceDate] = useState("");
  const [referenceReset, setReferenceReset] = useState(0);
  const [detailedLogs, setDetailedLogsChecked] = useState(
    () => !booting && detailedLogsEnabled(),
  );
  const [referenceValid, setReferenceValid] = useState(true);
  const referenceValidity = useRef(true);
  const [composing, setComposing] = useState(false);
  const composition = useRef(false);
  const [conversionRevision, setConversionRevision] = useState(0);
  const [conversion, setConversion] = useState<Conversion>({
    results: [],
    warnings: [],
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [preferenceError, setPreferenceError] = useState(false);
  const [manualCopy, setManualCopy] = useState("");
  const [pendingImport, setPendingImport] = useState<{
    text: string;
    source: "Shared" | "Clipboard";
  }>();
  const [offline, setOffline] = useState<OfflineState>({ ready: false });
  const [installPrompt, setInstallPrompt] = useState<any>();
  const [installHelp, setInstallHelp] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null),
    copyField = useRef<HTMLTextAreaElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [exampleIndex, setExampleIndex] = useState(0);
  const [interpretationFocus, setInterpretationFocus] = useState<
    "date-order" | "reference-date"
  >();
  const [dateControlsRequested, setDateControlsRequested] = useState(false);
  useLayoutEffect(() => {
    if (!booting) return;
    setPrefs(loadPreferences());
    setDevice(deviceTimezone());
    setAboutOpen(location.hash === "#about");
    setDetailedLogsChecked(detailedLogsEnabled());
    setInitializing(false);
  }, [booting]);
  // Retain editable date segments after the first open, including partial dates.
  useEffect(() => {
    if (optionsOpen) setDateControlsRequested(true);
  }, [optionsOpen]);
  const correctionFocus = useRef(false);
  const interpretationIntent = useRef(0);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const appearanceRetained = useRetainedOpen(appearanceOpen, 120);
  const [copyState, setCopyState] = useState<{
    id: string;
    state: "success" | "failure";
  }>();
  const copyReset = useRef<ReturnType<typeof setTimeout>>(undefined);
  const themeReset = useRef<ReturnType<typeof setTimeout>>(undefined);
  const committedGroups = useRef(new Set<string>());
  const [newGroups, setNewGroups] = useState(new Set<string>());
  const appearance = useRef<HTMLDetailsElement>(null);
  const themeResolutionFrame = useRef<number>(undefined);
  const worker = useRef<Worker | null>(null),
    request = useRef(0);
  const importRequest = useRef(0);
  // Imports conflict with user changes, not automatic conversion requests.
  const interactionVersion = useRef(0);
  const copyRequest = useRef(0);
  const copyFocusIntent = useRef(0);
  const draft = useRef(text);
  draft.current = text;
  const currentDevice = useRef(device);
  currentDevice.current = device;
  const currentSourcePreference = useRef(prefs.source);
  currentSourcePreference.current = prefs.source;
  const shareRead = useRef(false);
  const sourceZone = resolveZone(prefs.source, device),
    targetZone = resolveZone(prefs.target, device);
  const displayOptions: ConversionOptions = {
    sourceZone: sourceZone || device,
    targetZone: targetZone || device,
    hourCycle: prefs.hourCycle,
    dateOrder: prefs.dateOrder,
    referenceDate: referenceDate || undefined,
    locale: initializing ? "en-AU" : navigator.language || "en-AU",
  };

  useEffect(() => {
    const navigate = () => {
      setAboutOpen(location.hash === "#about");
      setAppearanceOpen(false);
    };
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);
  // Focus after hidden-page portals release their focus scopes.
  useEffect(() => {
    document.title = aboutOpen ? "About — Time to Local" : SITE_TITLE;
    if (aboutOpen) {
      document.getElementById("about-title")?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    } else if (previousAbout.current) {
      input.current?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
    previousAbout.current = aboutOpen;
  }, [aboutOpen]);

  useEffect(() => {
    const moved = () => copyFocusIntent.current++;
    // A newer focus, pointer or keyboard action owns focus even before it
    // changes a value. Keep this separate from draft/import invalidation.
    for (const event of ["focus", "pointerdown", "keydown"])
      document.addEventListener(event, moved, true);
    return () => {
      for (const event of ["focus", "pointerdown", "keydown"])
        document.removeEventListener(event, moved, true);
      copyFocusIntent.current++;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setupOffline(setOffline, controller.signal);
    const refresh = () => {
      const nextDevice = deviceTimezone();
      if (nextDevice !== currentDevice.current) {
        const source = currentSourcePreference.current;
        if (
          resolveZone(source, nextDevice) !==
          resolveZone(source, currentDevice.current)
        )
          invalidate();
        else invalidateDisplay();
        setDevice(nextDevice);
      }
    };
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    window.addEventListener("focus", refresh);
    const prompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener("beforeinstallprompt", prompt);
    return () => {
      controller.abort();
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("beforeinstallprompt", prompt);
    };
  }, []);
  useEffect(() => {
    if (shareRead.current) return;
    shareRead.current = true;
    const restore = consumeUpdate();
    if (restore) setText(restore);
    const params = new URLSearchParams(location.search),
      key = params.get("share");
    if (!key) clearAbandonedShares().catch(() => {});
    if (key) {
      const importId = ++importRequest.current,
        version = interactionVersion.current;
      history.replaceState(null, "", location.pathname);
      consumeShare(key)
        .then((message) => {
          if (importId !== importRequest.current) return;
          if (message) {
            receiveImport(message, "Shared", version, !!restore);
          } else
            setNotice("The shared text expired. Paste it here to continue.");
        })
        .catch(() => {
          if (importId === importRequest.current)
            setNotice(
              "Could not receive shared text. Paste it here to continue.",
            );
        });
    }
  }, []);
  useEffect(() => {
    if (!initializing && targetZone && sourceZone)
      setPreferenceError(!savePreferences(prefs));
  }, [initializing, prefs, targetZone, sourceZone]);
  useLayoutEffect(() => {
    if (initializing) return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const theme =
        prefs.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : prefs.theme;
      const immediate = !document.documentElement.dataset.themeChanging;
      if (immediate) document.documentElement.dataset.themeResolving = "true";
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.design = prefs.design;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute(
          "content",
          prefs.design === "aqua"
            ? theme === "dark"
              ? "#102d50"
              : "#b8d9ee"
            : theme === "dark"
              ? "#0c120f"
              : "#f7f4ed",
        );
      if (immediate) {
        // Resolve all palette styles while control feedback is suppressed.
        void document.documentElement.offsetHeight;
        themeResolutionFrame.current = requestAnimationFrame(() => {
          delete document.documentElement.dataset.themeResolving;
        });
      }
    };
    apply();
    const systemChanged = () => {
      delete document.documentElement.dataset.themeChanging;
      apply();
    };
    media.addEventListener("change", systemChanged);
    return () => {
      media.removeEventListener("change", systemChanged);
      if (themeResolutionFrame.current !== undefined)
        cancelAnimationFrame(themeResolutionFrame.current);
      delete document.documentElement.dataset.themeResolving;
    };
  }, [initializing, prefs.theme, prefs.design]);

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        !appearance.current?.contains(target) &&
        !target.closest(".choice-popover")
      ) {
        setAppearanceOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        document.querySelector(
          ".choice-popover:not([data-exiting]):not([inert])",
        )
      )
        return;
      if (appearance.current?.dataset.expanded === "true") {
        event.preventDefault();
        event.stopPropagation();
        setAppearanceOpen(false);
        appearance.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape, true);
      clearTimeout(copyReset.current);
      clearTimeout(themeReset.current);
      delete document.documentElement.dataset.themeChanging;
    };
  }, []);

  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const finish = () => {
      setEntering(false);
      setNewGroups(new Set());
    };
    const changed = () => {
      // Consume stale effects on either event, including coalesced rapid reversals.
      clearTimeout(themeReset.current);
      delete document.documentElement.dataset.themeChanging;
      flushSync(finish);
    };
    if (media.matches) finish();
    const timer = setTimeout(() => setEntering(false), 360);
    media.addEventListener("change", changed);
    return () => {
      clearTimeout(timer);
      media.removeEventListener("change", changed);
    };
  }, []);
  useLayoutEffect(() => {
    if (optionsOpen && correctionFocus.current) {
      correctionFocus.current = false;
      document.getElementById("source-zone")?.focus();
    }
  }, [optionsOpen]);

  useLayoutEffect(() => {
    if (!optionsOpen || !interpretationFocus) return;
    // Wait for the lazily loaded date editor before moving focus.
    const focus = () => {
      if (interpretationIntent.current !== copyFocusIntent.current) {
        setInterpretationFocus(undefined);
        return true;
      }
      const field =
        interpretationFocus === "reference-date"
          ? document.querySelector<HTMLElement>(
              '#reference-date [role="spinbutton"]',
            )
          : document.getElementById("date-order");
      if (!field) return false;
      field.focus();
      field.scrollIntoView({ block: "nearest" });
      setInterpretationFocus(undefined);
      return true;
    };
    if (focus()) return;
    // Collapsible mounts its content after expansion commits. Observe the
    // persistent disclosure owner so a first-open request can await that mount.
    const disclosure = document.querySelector(".options");
    if (!disclosure) return;
    const observer = new MutationObserver(focus);
    observer.observe(disclosure, {
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, [optionsOpen, interpretationFocus]);

  function openInterpretation(field: "date-order" | "reference-date") {
    interpretationIntent.current = copyFocusIntent.current;
    setInterpretationFocus(field);
    setOptionsOpen(true);
  }

  function changeTheme(theme: "dark" | "light" | "system") {
    if (theme === prefs.theme) return;
    clearTimeout(themeReset.current);
    if (theme === "system") {
      delete document.documentElement.dataset.themeChanging;
      themeReset.current = undefined;
    } else {
      document.documentElement.dataset.themeChanging = "true";
      themeReset.current = setTimeout(() => {
        delete document.documentElement.dataset.themeChanging;
      }, 200);
    }
    setPrefs({ ...prefs, theme });
  }

  function edit(value: string) {
    if (!value.trim()) committedGroups.current.clear();
    draft.current = value;
    setText(value);
    invalidate();
  }
  function invalidateDisplay() {
    // Display edits supersede imports and clipboard work without changing the
    // source interpretation or canceling a conversion already in flight.
    interactionVersion.current++;
    copyRequest.current++;
    setManualCopy("");
    setNewGroups(new Set());
    clearTimeout(copyReset.current);
    setCopyState(undefined);
    setNotice("");
  }
  function invalidate() {
    invalidateDisplay();
    request.current++;
    setConversionRevision((version) => version + 1);
    worker.current?.terminate();
    worker.current = null;
    setBusy(!!draft.current.trim() && !composition.current);
    setConversion({ results: [], warnings: [] });
    setError("");
  }
  const referenceValidityChanged = useCallback((valid: boolean) => {
    if (referenceValidity.current === valid) return;
    referenceValidity.current = valid;
    setReferenceValid(valid);
    invalidate();
  }, []);

  useEffect(() => {
    const id = ++request.current;
    let current: Worker | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ownsRequest = () =>
      id === request.current &&
      !composition.current &&
      (!current || worker.current === current);
    const cleanup = () => {
      clearTimeout(timer);
      current?.terminate();
      if (worker.current === current) worker.current = null;
      if (id === request.current) request.current++;
    };

    if (!text.trim() || composing) {
      setBusy(false);
      return cleanup;
    }
    // Pending includes the debounce, so every edit has immediate feedback.
    setBusy(true);
    timer = setTimeout(() => {
      if (!ownsRequest()) return;
      if (text.length > MAX_INPUT) {
        setBusy(false);
        setError(
          "Keep the message under 10,000 characters. Shorten it to continue.",
        );
        return;
      }
      if (!sourceZone) {
        setBusy(false);
        setError(
          "Choose a timezone from the list, or enter a city with one known timezone.",
        );
        return;
      }
      if (!referenceValid) {
        setBusy(false);
        setError("Complete or clear the reference date to continue.");
        return;
      }
      const started = performance.now();
      diagnostic("conversion.start", {
        requestId: id,
        characters: text.length,
      });
      setBusy(true);
      setError("");
      setConversion({ results: [], warnings: [] });
      try {
        current = new Worker(new URL("./engine/worker.ts", import.meta.url), {
          type: "module",
        });
        worker.current = current;
        const finish = () => {
          current?.terminate();
          if (worker.current === current) worker.current = null;
        };
        current.onmessage = (event) => {
          if (!ownsRequest() || event.data.id !== id) return;
          diagnostic("conversion.complete", {
            requestId: id,
            elapsedMs: performance.now() - started,
            reason: event.data.error ? "engine-error" : "success",
            results: event.data.conversion?.results.length,
            warnings: event.data.conversion?.warnings.length,
          });
          setBusy(false);
          if (event.data.error) setError(event.data.error);
          else {
            const next = new Set<string>(
              event.data.conversion.results.map(
                (result: TimeResult) => result.group,
              ),
            );
            setNewGroups(
              matchMedia("(prefers-reduced-motion: reduce)").matches
                ? new Set()
                : new Set(
                    [...next].filter(
                      (group) => !committedGroups.current.has(group),
                    ),
                  ),
            );
            committedGroups.current = next;
            setConversion(event.data.conversion);
            if (
              !event.data.conversion.results.length &&
              !event.data.conversion.warnings.length
            )
              setError(
                "No time found. Try a date and time, such as “April 9 at 3pm PT”.",
              );
          }
          finish();
        };
        current.onerror = () => {
          if (!ownsRequest()) return;
          diagnostic("conversion.failed", {
            requestId: id,
            elapsedMs: performance.now() - started,
            reason: "worker-error",
          });
          setBusy(false);
          setError("Could not convert this message. Edit it to try again.");
          finish();
        };
        current.postMessage({
          id,
          text,
          options: {
            sourceZone,
            // The parser resolves source instants; the selected target and
            // clock format belong only to rendering and copying those results.
            targetZone: sourceZone,
            dateOrder: prefs.dateOrder,
            referenceDate: referenceDate || undefined,
            locale: navigator.language || "en-AU",
            now: new Date().toISOString(),
          },
        });
      } catch {
        diagnostic("conversion.failed", {
          requestId: id,
          elapsedMs: performance.now() - started,
          reason: "worker-start-failed",
        });
        current?.terminate();
        if (worker.current === current) worker.current = null;
        setBusy(false);
        setError(
          "This browser could not start conversion. Edit the message to try again.",
        );
      }
    }, 250);
    return cleanup;
  }, [
    text,
    prefs.source,
    prefs.dateOrder,
    sourceZone,
    referenceDate,
    referenceValid,
    composing,
    conversionRevision,
  ]);
  function receiveImport(
    value: string,
    source: "Shared" | "Clipboard",
    version: number,
    preserveDraft = false,
  ) {
    if (preserveDraft || version !== interactionVersion.current) {
      setPendingImport({ text: value, source });
      return;
    }
    edit(value);
    if (source === "Shared") setNotice("Shared text received.");
    // Clipboard success must not reopen a mobile keyboard after permission UI.
    // Leave focus where the user (or browser) put it while the read was pending.
  }
  async function paste() {
    const importId = ++importRequest.current,
      version = interactionVersion.current;
    setPendingImport(undefined);
    try {
      const value = await navigator.clipboard.readText();
      if (importId !== importRequest.current) return;
      receiveImport(value, "Clipboard", version);
    } catch {
      if (importId !== importRequest.current) return;
      setNotice(
        "Paste directly into the message box using your keyboard or touch menu.",
      );
      input.current?.focus();
    }
  }
  function copy(result: TimeResult) {
    return copyValue(copyText(result, displayOptions), result.id);
  }
  async function copyValue(value: string, resultId: string) {
    if (!targetZone || !sourceZone) return;
    clearTimeout(copyReset.current);
    setCopyState(undefined);
    const copyId = ++copyRequest.current;
    const focusIntent = copyFocusIntent.current;
    diagnostic("copy.started", { requestId: copyId });
    try {
      await navigator.clipboard.writeText(value);
      if (copyId !== copyRequest.current) return;
      clearTimeout(copyReset.current);
      setCopyState({ id: resultId, state: "success" });
      copyReset.current = setTimeout(() => {
        if (copyId === copyRequest.current) setCopyState(undefined);
      }, 1500);
      setNotice("Copied with the date and timezone.");
      setManualCopy("");
    } catch {
      if (copyId !== copyRequest.current) return;
      clearTimeout(copyReset.current);
      setCopyState({ id: resultId, state: "failure" });
      setManualCopy(value);
      setNotice(
        "Select the text below and copy it using your keyboard or touch menu.",
      );
      diagnostic("copy.focus-scheduled", { requestId: copyId });
      requestAnimationFrame(() => {
        const field = copyField.current;
        const reason =
          copyId !== copyRequest.current
            ? "superseded"
            : focusIntent !== copyFocusIntent.current
              ? "new-interaction"
              : !field
                ? "no-field"
                : undefined;
        if (reason || !field) {
          diagnostic("copy.focus-skipped", {
            requestId: copyId,
            reason: reason || "no-field",
          });
          return;
        }
        field.focus();
        field.select();
        diagnostic("copy.focus-applied", { requestId: copyId });
      });
    }
  }
  function update() {
    const pending = offline.update;
    if (pending?.state !== "installed") return;
    if (draft.current && !preserveForUpdate(draft.current)) {
      diagnostic("offline.update-blocked", {
        reason: "draft-preservation-failed",
      });
      setNotice(UPDATE_STORAGE_WARNING);
      return;
    }
    diagnostic("offline.update-accepted");
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => location.reload(),
      { once: true },
    );
    pending.postMessage({ type: "ACTIVATE_UPDATE" });
  }
  const groups = targetZone ? resultGroups(conversion.results) : [];
  const summary = resultSummary(groups);
  const targetError =
    !targetZone && text.trim()
      ? "Choose a timezone from the list, or enter a city with one known timezone."
      : "";
  const visibleError = targetError || error;
  const liveState = composing
    ? "paused"
    : busy
      ? "pending"
      : visibleError
        ? "error"
        : conversion.warnings.length
          ? "warning"
          : groups.some((group) => group.ambiguous)
            ? "ambiguous"
            : conversion.results.length
              ? "ready"
              : "idle";
  const updateWarning =
    offline.update && notice === UPDATE_STORAGE_WARNING ? notice : "";
  const generalNotice = updateWarning ? "" : notice;
  const updateNotice = offline.update && (
    <div className="update-notice">
      <div className="update-banner">
        <p>
          A new version is ready. Your message will be kept when you update.
        </p>
        <ActionButton variant="primary" type="button" onPress={update}>
          Update now
        </ActionButton>
      </div>
      <div role="status" className="update-warning">
        {updateWarning}
      </div>
    </div>
  );
  return (
    <>
      <header className="topbar">
        <a
          className="brand"
          href={aboutOpen ? "#converter" : base}
          aria-label="Time to Local home"
        >
          <span className="brand-clock" aria-hidden="true" />
          Time to Local
        </a>
        <div className="header-tools">
          <details
            className="appearance"
            inert={initializing}
            ref={appearance}
            open={appearanceRetained}
            data-expanded={appearanceOpen}
          >
            <summary
              aria-label="Appearance"
              aria-expanded={appearanceOpen}
              onClick={(event) => {
                event.preventDefault();
                setAppearanceOpen(!appearanceOpen);
              }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="8" />
                <path
                  d="M12 4a8 8 0 0 0 0 16Z"
                  fill="currentColor"
                  stroke="none"
                />
              </svg>
              <span className="appearance-label">Appearance</span>
            </summary>
            <div
              className="appearance-fields"
              inert={!appearanceOpen}
              aria-hidden={!appearanceOpen}
            >
              <label htmlFor="design">Design</label>
              <ChoiceSelect
                id="design"
                label="Design"
                value={prefs.design}
                onChange={(design) => {
                  clearTimeout(themeReset.current);
                  delete document.documentElement.dataset.themeChanging;
                  setPrefs({ ...prefs, design: design as "command" | "aqua" });
                }}
                options={[
                  { id: "command", label: "Original" },
                  { id: "aqua", label: "Aqua" },
                ]}
              />
              <label htmlFor="theme">Theme</label>
              <ChoiceSelect
                id="theme"
                label="Theme"
                value={prefs.theme}
                onChange={(theme) =>
                  changeTheme(theme as "dark" | "light" | "system")
                }
                options={[
                  { id: "dark", label: "Dark" },
                  { id: "light", label: "Light" },
                  { id: "system", label: "System" },
                ]}
              />
            </div>
          </details>
        </div>
      </header>
      {aboutOpen && (
        <About updateNotice={updateNotice} notice={generalNotice} />
      )}
      <PopoverVisibilityContext.Provider value={!aboutOpen}>
        <main
          data-offline-ready={offline.ready}
          data-app-ready={!initializing}
          hidden={aboutOpen}
        >
          <h1 className="sr-only">Time zone converter</h1>
          <ConverterIntro />
          <noscript>
            <p className="javascript-notice">
              Enable JavaScript to use the converter.
            </p>
          </noscript>
          {!aboutOpen && updateNotice}
          <div
            className={`workspace ${conversion.results.length ? "has-results" : ""}`}
            data-entering={entering}
            inert={initializing}
            aria-busy={initializing}
          >
            <section className="input-panel" aria-labelledby="input-title">
              <div className="panel-heading input-heading">
                <h2 id="input-title">Message</h2>
                <ActionButton
                  type="button"
                  className="result-shortcut"
                  aria-controls="result-title"
                  style={{ visibility: text.trim() ? "visible" : "hidden" }}
                  onPress={() => {
                    resultHeading.current?.focus({ preventScroll: true });
                    resultHeading.current?.scrollIntoView({ block: "start" });
                  }}
                >
                  View result <ControlIcon name="down" />
                </ActionButton>
              </div>
              <label className="sr-only" htmlFor="message">
                Message with a date or time
              </label>
              <textarea
                ref={input}
                id="message"
                value={text}
                placeholder="e.g. April 9, 2026 3pm in Tokyo"
                onChange={(e) => edit(e.target.value)}
                onCompositionStart={() => {
                  composition.current = true;
                  setComposing(true);
                  invalidate();
                }}
                onCompositionEnd={(event) => {
                  composition.current = false;
                  setComposing(false);
                  edit(event.currentTarget.value);
                }}
                spellCheck={false}
                aria-describedby="input-help"
              />
              <p className="live-help">Results update as you type.</p>
              <div className="input-tools">
                <ActionButton
                  type="button"
                  className="example-button muted"
                  onPress={() => {
                    edit(examples[exampleIndex % examples.length]);
                    setExampleIndex(exampleIndex + 1);
                    input.current?.focus();
                  }}
                >
                  {exampleIndex ? "Next example" : "Try example"}
                </ActionButton>
                <div>
                  <ActionButton
                    type="button"
                    variant="outline"
                    preventFocusOnPress
                    onPress={paste}
                  >
                    Paste
                  </ActionButton>
                  {text && (
                    <ActionButton
                      type="button"
                      className="text-button muted"
                      onPress={() => {
                        edit("");
                        input.current?.focus();
                      }}
                    >
                      Clear
                    </ActionButton>
                  )}
                </div>
                <span
                  id="input-help"
                  className={
                    text.length > MAX_INPUT
                      ? "limit exceeded"
                      : text.length > 8000
                        ? "limit"
                        : "sr-only"
                  }
                >
                  {text.length > 8000
                    ? `${text.length.toLocaleString()} / 10,000`
                    : "Converts as you type"}
                </span>
              </div>
              <div className="target-field">
                <label htmlFor="target-zone">Convert to</label>
                <div className="conversion-controls">
                  <ZoneChoice
                    id="target-zone"
                    label="Convert to"
                    value={prefs.target}
                    onChange={(target) => {
                      setPrefs({ ...prefs, target });
                      invalidateDisplay();
                    }}
                    invalid={!targetZone}
                    describedBy="target-zone-help"
                    placeholder={
                      initializing
                        ? "Your timezone"
                        : `Your timezone · ${zoneName(device)}`
                    }
                    triggerLabel="Show target timezones"
                  />
                </div>
                <span className="field-note" id="target-zone-help">
                  {initializing
                    ? "Preparing your timezone…"
                    : targetZone
                      ? targetZone.includes("/")
                        ? targetZone
                        : zoneName(targetZone)
                      : "Choose a timezone or city from the list"}
                </span>
              </div>

              {(optionsOpen ||
                prefs.source.trim() ||
                referenceDate ||
                !referenceValid) && (
                <div className="message-defaults">
                  <span>
                    Without a timezone:{" "}
                    {sourceZone || "Choose a valid timezone"}
                    {!prefs.source.trim() && " (device)"}
                    <br />
                    Reference date:{" "}
                    {!referenceValid
                      ? "Complete or clear the date"
                      : referenceDate || "Today"}
                  </span>
                  <ActionButton
                    type="button"
                    className="text-button"
                    onPress={() => {
                      if (optionsOpen)
                        document.getElementById("source-zone")?.focus();
                      else {
                        correctionFocus.current = true;
                        setOptionsOpen(true);
                      }
                    }}
                  >
                    Change message defaults
                  </ActionButton>
                </div>
              )}
              <Disclosure
                open={optionsOpen}
                onOpenChange={(open) => {
                  setOptionsOpen(open);
                  if (!open) setInterpretationFocus(undefined);
                }}
              >
                <label htmlFor="source-zone">Source timezone</label>
                <ZoneChoice
                  id="source-zone"
                  label="Source timezone"
                  value={prefs.source}
                  onChange={(source) => {
                    setPrefs({ ...prefs, source });
                    invalidate();
                  }}
                  placeholder={`Device timezone · ${device}`}
                  describedBy="source-zone-help"
                  invalid={!sourceZone}
                  triggerLabel="Show source timezones"
                />
                <span className="field-note" id="source-zone-help">
                  For “3pm” without a timezone. A timezone in the message takes
                  priority. Leave blank to use your device: {device}.
                </span>
                {(optionsOpen || dateControlsRequested) && (
                  <DeferredDateChoice
                    key={referenceReset}
                    id="reference-date"
                    label="Reference date"
                    describedBy="reference-date-help"
                    value={referenceDate}
                    onChange={(date) => {
                      setReferenceDate(date);
                      invalidate();
                    }}
                    onValidityChange={referenceValidityChanged}
                  />
                )}
                <span className="field-note" id="reference-date-help">
                  For relative or incomplete dates. If an older message says
                  “tomorrow”, choose its date here. Leave blank to use today.
                  The date is anchored in the source timezone; use a full date
                  in the message to avoid a day shift in a distant timezone.
                </span>
                <label htmlFor="date-order">Date order in messages</label>
                <ChoiceSelect
                  id="date-order"
                  label="Date order in messages"
                  describedBy="date-order-help"
                  value={prefs.dateOrder}
                  onChange={(dateOrder) => {
                    setPrefs({
                      ...prefs,
                      dateOrder: dateOrder as "mdy" | "dmy",
                    });
                    invalidate();
                  }}
                  options={[
                    { id: "mdy", label: "Month/day (04/09 = April 9)" },
                    { id: "dmy", label: "Day/month (04/09 = 4 September)" },
                  ]}
                />
                <span className="field-note" id="date-order-help">
                  How to read numeric dates in your message.
                </span>
              </Disclosure>
            </section>
            <section
              className="result-panel"
              aria-labelledby="result-title"
              aria-busy={busy}
            >
              <div className="panel-heading result-heading">
                <h2
                  id="result-title"
                  ref={resultHeading}
                  tabIndex={-1}
                  aria-label={
                    !initializing && targetZone
                      ? `Converted time in ${zoneName(targetZone)}`
                      : "Converted time"
                  }
                >
                  {!initializing && targetZone
                    ? `In ${zoneName(targetZone)}`
                    : "Converted time"}
                </h2>
                <span className="live-indicator" data-state={liveState}>
                  {initializing
                    ? "Preparing"
                    : liveState === "pending"
                      ? "Updating"
                      : liveState === "paused"
                        ? "Paused"
                        : liveState === "error"
                          ? "Check input"
                          : liveState === "warning"
                            ? "Check time"
                            : summary}
                </span>
              </div>
              <div role="status" className="sr-only">
                {busy
                  ? "Updating conversion"
                  : composing
                    ? "Finish typing to convert"
                    : targetZone && conversion.results.length
                      ? summary
                      : ""}
              </div>
              {visibleError && (
                <div className="message error" role="alert">
                  {visibleError}
                </div>
              )}
              {targetZone &&
                conversion.warnings.map((w) => (
                  <div key={w} className="message warning" role="alert">
                    {w}
                  </div>
                ))}
              {!conversion.results.length &&
                !visibleError &&
                !conversion.warnings.length && (
                  <div className="result-placeholder" key={liveState}>
                    <span className="large-clock" aria-hidden="true" />
                    <h3>
                      {initializing
                        ? "Preparing converter…"
                        : busy
                          ? "Finding your time…"
                          : composing
                            ? "Finish typing to convert"
                            : "Ready to convert"}
                    </h3>
                    <p>Date, time and timezone appear here.</p>
                  </div>
                )}
              {groups.map((group, groupIndex) => (
                <article
                  className={`result-group${group.entries.some((entry) => newGroups.has(entry.group)) ? " is-new-group" : ""}`}
                  key={group.id}
                  style={{
                    animationDelay: `${Math.min(groupIndex, 2) * 30}ms`,
                  }}
                  onAnimationEnd={(event) => {
                    if (
                      event.target !== event.currentTarget ||
                      event.animationName !== "surface-fade" ||
                      event.currentTarget
                        .getAnimations()
                        .some(
                          (animation) =>
                            animation instanceof CSSAnimation &&
                            animation.animationName === "surface-fade" &&
                            animation.playState !== "finished",
                        )
                    )
                      return;
                    // A queued event from an older animation must not consume
                    // a replacement still running on this same DOM surface.
                    const completed = new Set(
                      group.entries.map((entry) => entry.group),
                    );
                    setNewGroups(
                      (current) =>
                        new Set(
                          [...current].filter((id) => !completed.has(id)),
                        ),
                    );
                  }}
                >
                  <ResultCard
                    group={group}
                    options={displayOptions}
                    copyState={copyState}
                    onCopy={copy}
                    onCopyRange={(pair, id) =>
                      copyValue(copyRangeText(pair, displayOptions), id)
                    }
                    onInterpret={openInterpretation}
                  />
                </article>
              ))}
            </section>
          </div>
          <div role="status" className="notice">
            {generalNotice}
          </div>
          {pendingImport && (
            <div className="import-choice">
              <p role="status">
                {pendingImport.source} text arrived. Replace the current
                message?
              </p>
              <div>
                <ActionButton
                  type="button"
                  className="text-button"
                  onPress={() => {
                    edit(pendingImport.text);
                    setPendingImport(undefined);
                    setNotice("Imported text received.");
                    input.current?.focus();
                  }}
                >
                  Replace with imported text
                </ActionButton>
                <ActionButton
                  type="button"
                  className="text-button muted"
                  onPress={() => setPendingImport(undefined)}
                >
                  Dismiss imported text
                </ActionButton>
              </div>
            </div>
          )}
          {preferenceError && (
            <p className="message warning">
              Preferences cannot be saved in this browser. Conversion still
              works.
            </p>
          )}
          {manualCopy && (
            <div className="manual-copy">
              <label htmlFor="manual-copy">Text to copy</label>
              <textarea
                ref={copyField}
                id="manual-copy"
                value={manualCopy}
                readOnly
                onFocus={(e) => e.target.select()}
              />
            </div>
          )}
          {offline.error && <p className="message warning">{offline.error}</p>}
          <footer>
            <p>Your text stays on this device.</p>
            <nav className="footer-links" aria-label="About and source code">
              <a href="#about">About</a>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                GitHub
              </a>
            </nav>
            <ActionButton
              type="button"
              className="text-button"
              onPress={async () => {
                if (installPrompt) {
                  await installPrompt.prompt();
                  setInstallPrompt(undefined);
                } else setInstallHelp(!installHelp);
              }}
            >
              Keep Time to Local handy
            </ActionButton>
          </footer>
          <section className="preferences" aria-label="Preferences and support">
            <Disclosure
              open={displayOpen}
              onOpenChange={setDisplayOpen}
              label="Display preferences"
              id="display-options"
            >
              <label htmlFor="time-format">Time format</label>
              <ChoiceSelect
                id="time-format"
                label="Time format"
                describedBy="time-format-help"
                value={prefs.hourCycle}
                onChange={(hourCycle) => {
                  setPrefs({
                    ...prefs,
                    hourCycle: hourCycle as "auto" | "12" | "24",
                  });
                  invalidateDisplay();
                }}
                options={[
                  { id: "auto", label: "Device format" },
                  { id: "12", label: "12-hour (3:00 PM)" },
                  { id: "24", label: "24-hour (15:00)" },
                ]}
              />
              <span className="field-note" id="time-format-help">
                How to display and copy converted times.
              </span>
            </Disclosure>
            <Disclosure
              open={supportOpen}
              onOpenChange={setSupportOpen}
              label="Support diagnostics"
              id="support-options"
            >
              <label className="diagnostic-toggle">
                <input
                  type="checkbox"
                  checked={detailedLogs}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    setDetailedLogsChecked(enabled);
                    setDetailedLogs(enabled);
                  }}
                />
                <span>Enable detailed logs</span>
              </label>
              <span className="field-note">
                Console only. Message text excluded.
              </span>
            </Disclosure>
            <ActionButton
              type="button"
              className="text-button reset-preferences"
              onPress={() => {
                setDetailedLogs(false);
                setDetailedLogsChecked(false);
                resetPreferences();
                setPrefs({ ...DEFAULTS });
                setReferenceDate("");
                referenceValidity.current = true;
                setReferenceValid(true);
                setReferenceReset((version) => version + 1);
                invalidate();
                setNotice("Preferences reset.");
              }}
            >
              Reset preferences
            </ActionButton>
          </section>
          <ConverterGuide />
          {installHelp && (
            <div className="install-help">
              <h2>Use it anytime</h2>
              <p>
                Open your browser’s menu and choose <strong>Install app</strong>
                , <strong>Add to Home Screen</strong>, or{" "}
                <strong>Add to Dock</strong>, if offered. On iPhone, look in the
                Share menu.
              </p>
              <p>
                You can also bookmark this page. If you clear browser storage,
                open it online again before using it offline.
              </p>
              {!offline.ready && (
                <p>
                  Keep this page open online to finish saving it for offline
                  use.
                </p>
              )}
              <ActionButton
                className="text-button"
                type="button"
                onPress={() => setInstallHelp(false)}
              >
                Got it
              </ActionButton>
            </div>
          )}
        </main>
      </PopoverVisibilityContext.Provider>
    </>
  );
}
