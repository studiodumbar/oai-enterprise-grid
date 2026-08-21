// Command-line style export controls for the browser console. The module stays
// DOM-free: `sketch.js` hands it the callbacks it needs, so the same parser and
// dispatcher run under `node --test`.
import {
  EXPORT_MODES,
  MAX_EXPORT_DIMENSION,
  MAX_EXPORT_FPS,
  MOTION_EXPORT_FORMATS,
  STATIC_EXPORT_FORMATS,
  normalizeExportState,
} from "./export-state.js";
import { DEBUG_CHANNEL_NAMES, configureDebug, debug } from "../debug/index.js";
import {
  ASPECT_RATIO_PRESETS,
  LONG_EDGE_PRESETS,
  sizeFromAspect,
} from "./resolution.js";

const ALL_FORMATS = Object.freeze([...STATIC_EXPORT_FORMATS, ...MOTION_EXPORT_FORMATS]);

// Shorthand flags (`--mp4`) and the long form (`--format mp4`) resolve through
// the same table, so `sequence` stays an alias rather than a second code path.
const FORMAT_ALIASES = Object.freeze({
  sequence: "png-sequence",
  pngsequence: "png-sequence",
  "png-seq": "png-sequence",
  jpg: null,
});

const PANEL_ACTIONS = Object.freeze(["show", "hide", "toggle"]);
const DEFAULT_PREVIEW_REPEATS = 3;
const MAX_PREVIEW_REPEATS = 100;
const DEFAULT_EXPORT_CYCLES = 1;
const MAX_EXPORT_CYCLES = 100;

export const CONSOLE_HELP = `Circle Grid console

  cg\`export --all --mp4\`        run commands as a tagged template
  cg("export --all --mp4")      …or as a plain string

Commands
  help                          this text
  list                          list composition ids (* marks the active one)
  status                        active composition, panel visibility, export settings
  use <composition>             switch the live composition
  export [flags]                export the active composition (or --all / --composition)
  panel show|hide|toggle        show or hide the export panel
  debug [channels|all|off]      trace subsystem state changes to the console

Export flags
  --all                         export every composition, one after another
  --preview-flicker             export base for every flicker in canvas + cell scope
  --repeats N                   replay each flicker 1-${MAX_PREVIEW_REPEATS} times (default: ${DEFAULT_PREVIEW_REPEATS})
  --cycles N                    repeat each motion-export cycle 1-${MAX_EXPORT_CYCLES} times
  --composition a,b   -c a,b    export the named compositions
  --png --svg                   still formats
  --mp4 --webm --png-sequence   motion formats
  --format <name>               any of: ${ALL_FORMATS.join(", ")}
  --aspect 16:9                 one of: ${ASPECT_RATIO_PRESETS.join(", ")}
  --resolution 1080p            long edge: ${Object.keys(LONG_EDGE_PRESETS).join(", ")} (or its pixel value)
  --width N --height N          exact output size, overrides --aspect/--resolution
  --fps N                       1-${MAX_EXPORT_FPS}, motion formats only
  --transparent                 transparent background (--no-transparent to clear)
  --embed-state                 embed project state (--no-embed-state to clear)
  --dry-run                     apply the settings and report the plan, export nothing

Examples
  cg\`export --mp4 --fps 60\`
  cg\`export --mp4 --cycles 4\`
  cg\`export --all --png --aspect 9:16 --resolution 4K\`
  cg\`export --preview-flicker --mp4 --repeats 3\`
  cg\`export -c voronoi,l-tree --svg\`
  cg\`panel hide\``;

// Splits a command line into tokens, honouring single and double quotes so
// values such as --aspect "16:9" survive intact.
export function tokenize(input) {
  const text = String(input ?? "");
  const tokens = [];
  let current = "";
  let quote = null;
  let started = false;
  for (const character of text) {
    if (quote) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      started = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (started) tokens.push(current);
      current = "";
      started = false;
      continue;
    }
    current += character;
    started = true;
  }
  if (quote) throw new Error(`Unbalanced ${quote} in command.`);
  if (started) tokens.push(current);
  return tokens;
}

function assignFlag(flags, key, value) {
  if (key.startsWith("no-")) {
    flags[key.slice(3)] = false;
    return;
  }
  flags[key] = value;
}

// `--key=value`, `--key value`, `--key` (true), `--no-key` (false) and short
// `-c value`. A value that begins with `-` is treated as the next flag, so
// `export --all --mp4` never swallows `--mp4` as the value of `--all`.
export function parseCommandLine(input) {
  const tokens = tokenize(input);
  const flags = {};
  const args = [];
  const name = tokens.shift() ?? "";
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("-") || token === "-") {
      args.push(token);
      continue;
    }
    const trimmed = token.replace(/^--?/, "");
    const equals = trimmed.indexOf("=");
    if (equals !== -1) {
      assignFlag(flags, trimmed.slice(0, equals), trimmed.slice(equals + 1));
      continue;
    }
    const next = tokens[index + 1];
    if (next !== undefined && !next.startsWith("-")) {
      assignFlag(flags, trimmed, next);
      index += 1;
      continue;
    }
    assignFlag(flags, trimmed, true);
  }
  return { name: name.toLowerCase(), args, flags };
}

function fail(message) {
  throw new Error(message);
}

function boundedInteger(value, label, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.round(number) !== number) {
    fail(`${label} must be a whole number, got "${value}".`);
  }
  if (number < minimum || number > maximum) {
    fail(`${label} must be between ${minimum} and ${maximum}, got ${number}.`);
  }
  return number;
}

function canonicalFormat(value) {
  const key = String(value).toLowerCase();
  const alias = Object.hasOwn(FORMAT_ALIASES, key) ? FORMAT_ALIASES[key] : key;
  if (!alias || !ALL_FORMATS.includes(alias)) {
    fail(`Unknown format "${value}". Use one of: ${ALL_FORMATS.join(", ")}.`);
  }
  return alias;
}

function requestedFormat(flags) {
  const requested = [];
  if (flags.format !== undefined) {
    if (flags.format === true) fail("--format needs a value, e.g. --format mp4.");
    requested.push(canonicalFormat(flags.format));
  }
  for (const [key, value] of Object.entries(flags)) {
    if (key === "format" || value !== true) continue;
    const alias = Object.hasOwn(FORMAT_ALIASES, key) ? FORMAT_ALIASES[key] : key;
    if (alias && ALL_FORMATS.includes(alias)) requested.push(alias);
  }
  const unique = [...new Set(requested)];
  if (unique.length > 1) fail(`Pick one format, got: ${unique.join(", ")}.`);
  return unique[0] ?? null;
}

function requestedLongEdge(value) {
  if (value === true) fail("--resolution needs a value, e.g. --resolution 1080p.");
  const key = String(value);
  if (Object.hasOwn(LONG_EDGE_PRESETS, key)) return LONG_EDGE_PRESETS[key];
  const presets = Object.values(LONG_EDGE_PRESETS);
  const number = Number(key);
  if (presets.includes(number)) return number;
  const names = Object.entries(LONG_EDGE_PRESETS)
    .map(([label, pixels]) => `${label} (${pixels})`)
    .join(", ");
  return fail(`Unknown resolution "${value}". Use one of: ${names}.`);
}

// Mutates `state` with whatever the flags asked for and reports the keys that
// changed, so the caller can log the plan and re-sync the panel.
export function applyExportFlags(state, flags) {
  const before = { ...state };
  const format = requestedFormat(flags);
  if (format) {
    state.exportFormat = format;
    state.mode = STATIC_EXPORT_FORMATS.includes(format)
      ? EXPORT_MODES.STATIC
      : EXPORT_MODES.MOTION;
  } else if (flags.mode !== undefined) {
    const mode = String(flags.mode).toLowerCase();
    if (mode !== EXPORT_MODES.STATIC && mode !== EXPORT_MODES.MOTION) {
      fail(`Unknown mode "${flags.mode}". Use static or motion.`);
    }
    if (mode !== state.mode) {
      state.mode = mode;
      state.exportFormat = mode === EXPORT_MODES.MOTION ? "mp4" : "png";
    }
  }

  if (flags.aspect !== undefined) {
    if (!ASPECT_RATIO_PRESETS.includes(String(flags.aspect))) {
      fail(`Unknown aspect "${flags.aspect}". Use one of: ${ASPECT_RATIO_PRESETS.join(", ")}.`);
    }
    state.aspect = String(flags.aspect);
  }
  if (flags.resolution !== undefined) state.resolution = requestedLongEdge(flags.resolution);
  if (flags.aspect !== undefined || flags.resolution !== undefined) {
    const size = sizeFromAspect(state.aspect, state.resolution);
    state.resW = size.width;
    state.resH = size.height;
  }

  if (flags.width !== undefined) {
    state.resW = boundedInteger(flags.width, "--width", 2, MAX_EXPORT_DIMENSION);
  }
  if (flags.height !== undefined) {
    state.resH = boundedInteger(flags.height, "--height", 2, MAX_EXPORT_DIMENSION);
  }
  if (flags.fps !== undefined) {
    state.fps = boundedInteger(flags.fps, "--fps", 1, MAX_EXPORT_FPS);
  }
  if (flags.transparent !== undefined) state.transparentBg = flags.transparent !== false;
  if (flags["embed-state"] !== undefined) {
    state.embedProjectState = flags["embed-state"] !== false;
  }

  normalizeExportState(state);
  return Object.keys(state).filter(key => state[key] !== before[key]);
}

// `--all` walks the canonical compositions only: the director also lists legacy
// aliases (`thinking` for `inference-loop`), and exporting those would render
// the same composition twice.
function targetCompositions(flags, {
  list,
  canonical,
  active,
  previewComposition,
}) {
  const named = flags.composition ?? flags.c;
  const previewFlicker = flags["preview-flicker"];
  if (previewFlicker !== undefined && previewFlicker !== true) {
    fail("--preview-flicker does not take a value.");
  }
  if (previewFlicker === true && (flags.all === true || named !== undefined)) {
    fail("Use --preview-flicker by itself, without --all or --composition.");
  }
  if (previewFlicker === true) {
    if (!list.includes(previewComposition)) {
      fail(`Flicker preview composition "${previewComposition}" is not registered.`);
    }
    return [previewComposition];
  }
  if (flags.all === true && named !== undefined) {
    fail("Use either --all or --composition, not both.");
  }
  if (flags.all === true) {
    if (canonical.length === 0) fail("No compositions are registered.");
    return canonical;
  }
  if (named === undefined) return [active];
  if (named === true) fail("--composition needs a value, e.g. --composition voronoi.");
  const ids = String(named).split(",").map(id => id.trim()).filter(Boolean);
  if (ids.length === 0) fail("--composition needs at least one composition id.");
  for (const id of ids) {
    if (!list.includes(id)) {
      fail(`Unknown composition "${id}". Run cg\`list\` to see the available ids.`);
    }
  }
  return ids;
}

function previewRepeatCount(flags, previewFlicker, fallback = DEFAULT_PREVIEW_REPEATS) {
  const authored = flags.repeats ?? flags.replays;
  if (flags.repeats !== undefined && flags.replays !== undefined) {
    fail("Use either --repeats or --replays, not both.");
  }
  if (!previewFlicker && authored !== undefined) {
    fail("--repeats is available only with --preview-flicker.");
  }
  if (!previewFlicker) return null;
  if (authored === undefined) return boundedInteger(
    fallback,
    "Default preview repeats",
    1,
    MAX_PREVIEW_REPEATS,
  );
  if (authored === true) fail("--repeats needs a value, e.g. --repeats 3.");
  return boundedInteger(authored, "--repeats", 1, MAX_PREVIEW_REPEATS);
}

function exportCycleCount(flags, mode) {
  const authored = flags.cycles;
  if (authored === undefined) return DEFAULT_EXPORT_CYCLES;
  if (mode !== EXPORT_MODES.MOTION) {
    fail("--cycles is available only for motion exports.");
  }
  if (authored === true) fail("--cycles needs a value, e.g. --cycles 3.");
  return boundedInteger(authored, "--cycles", 1, MAX_EXPORT_CYCLES);
}

function panelAction(parsed) {
  const fromArgs = parsed.args[0]?.toLowerCase();
  if (fromArgs) {
    if (!PANEL_ACTIONS.includes(fromArgs)) {
      fail(`Unknown panel action "${parsed.args[0]}". Use show, hide, or toggle.`);
    }
    return fromArgs;
  }
  const fromFlags = PANEL_ACTIONS.filter(action => parsed.flags[action] === true);
  if (fromFlags.length > 1) fail(`Pick one panel action, got: ${fromFlags.join(", ")}.`);
  return fromFlags[0] ?? "toggle";
}

export function createExportConsole({
  state,
  runExport,
  listCompositions,
  canonicalCompositions = listCompositions,
  activeComposition,
  useComposition,
  previewComposition = "base",
  listFlickerModes = () => [],
  listFlickerScopes = () => ["canvas", "cell"],
  defaultPreviewRepeats = DEFAULT_PREVIEW_REPEATS,
  activeFlickerPreview = () => null,
  useFlickerPreview,
  setPanelVisible,
  isPanelVisible,
  syncPanel,
  onStateChange,
  isExporting = () => false,
  log = () => {},
} = {}) {
  function snapshot() {
    return {
      composition: activeComposition(),
      panelVisible: isPanelVisible(),
      export: { ...state },
    };
  }

  async function runExportCommand(parsed) {
    if (isExporting()) fail("An export is already running.");
    const changed = applyExportFlags(state, parsed.flags);
    syncPanel?.();
    if (changed.length > 0) onStateChange?.(state, changed);
    const list = listCompositions();
    const startedOn = activeComposition();
    const targets = targetCompositions(parsed.flags, {
      list,
      canonical: canonicalCompositions(),
      active: startedOn,
      previewComposition,
    });
    const previewFlicker = parsed.flags["preview-flicker"] === true;
    const flickers = previewFlicker ? listFlickerModes() : [];
    const scopes = previewFlicker ? [...new Set(listFlickerScopes())] : [];
    const repeats = previewRepeatCount(
      parsed.flags,
      previewFlicker,
      defaultPreviewRepeats,
    );
    const cycles = exportCycleCount(parsed.flags, state.mode);
    if (previewFlicker && flickers.length === 0) {
      fail("No flicker modes are registered for preview.");
    }
    if (previewFlicker && scopes.length === 0) {
      fail("No flicker scopes are registered for preview.");
    }
    if (previewFlicker && typeof useFlickerPreview !== "function") {
      fail("Flicker preview mode switching is unavailable.");
    }
    const jobs = previewFlicker
      ? scopes.flatMap(scope => flickers.map(flicker => ({
        composition: previewComposition,
        flicker,
        scope,
        repeats,
        cycles,
      })))
      : targets.map(composition => ({ composition, flicker: null, cycles }));
    const plan = {
      compositions: targets,
      flickers,
      scopes,
      repeats,
      cycles,
      format: state.exportFormat,
      size: `${state.resW}x${state.resH}`,
      fps: state.mode === EXPORT_MODES.MOTION ? state.fps : null,
      changed,
    };

    if (parsed.flags["dry-run"] === true) {
      log(
        previewFlicker
          ? `Dry run: would export ${jobs.length} flicker preview(s), ${repeats} flicker repeat(s) across ${cycles} cycle(s) each, as ${state.exportFormat}.`
          : `Dry run: would export ${targets.length} composition(s), ${cycles} cycle(s) each, as ${state.exportFormat}.`,
      );
      return { ok: true, dryRun: true, ...plan, results: [] };
    }

    const results = [];
    let startingPreview = null;
    let previewPrepared = false;
    try {
      if (previewFlicker) {
        if (previewComposition !== activeComposition()) useComposition(previewComposition);
        startingPreview = activeFlickerPreview();
        if (!startingPreview || typeof startingPreview !== "object") {
          fail("The active flicker preview state is unavailable.");
        }
        previewPrepared = true;
      }
      for (const [index, job] of jobs.entries()) {
        const { composition, flicker, scope } = job;
        if (composition !== activeComposition()) useComposition(composition);
        if (flicker !== null) {
          useFlickerPreview({ mode: flicker, scope, repeats });
        }
        const label = flicker === null ? composition : `${scope} / ${flicker}`;
        log(`Exporting ${label} (${index + 1}/${jobs.length}) as ${state.exportFormat}…`);
        const result = await runExport({ cycles });
        const ok = result?.ok !== false;
        results.push({
          composition,
          cycles,
          ...(flicker === null ? {} : { flicker, scope, repeats }),
          ok,
          error: ok ? null : (result?.error?.message ?? String(result?.error ?? "Export failed.")),
        });
        if (!ok) log(`Failed: ${label} — ${results.at(-1).error}`);
      }
    } finally {
      if (previewPrepared && startingPreview) {
        if (activeComposition() !== previewComposition) useComposition(previewComposition);
        useFlickerPreview(startingPreview);
      }
      if (activeComposition() !== startedOn) useComposition(startedOn);
    }

    const failed = results.filter(result => !result.ok);
    log(
      failed.length === 0
        ? previewFlicker
          ? `Exported ${results.length} flicker preview(s) as ${state.exportFormat}.`
          : `Exported ${results.length} composition(s) as ${state.exportFormat}.`
        : `Exported ${results.length - failed.length}/${results.length}; ${failed.length} failed.`,
    );
    return { ok: failed.length === 0, ...plan, results };
  }

  async function dispatch(parsed) {
    switch (parsed.name) {
      case "help":
      case "?":
        log(CONSOLE_HELP);
        return { ok: true, help: CONSOLE_HELP };
      case "list": {
        const list = listCompositions();
        const active = activeComposition();
        log(list.map(id => `${id === active ? "*" : " "} ${id}`).join("\n"));
        return { ok: true, compositions: list, active };
      }
      case "status": {
        const current = snapshot();
        log(JSON.stringify(current, null, 2));
        return { ok: true, ...current };
      }
      case "debug": {
        if (parsed.args.length === 0) {
          const active = debug.channels();
          log(active.length > 0
            ? `Debug channels: ${active.join(", ")}`
            : `Debug is off. Available channels: ${DEBUG_CHANNEL_NAMES.join(", ")}, all.`);
          return { ok: true, channels: active, available: [...DEBUG_CHANNEL_NAMES] };
        }
        const selector = parsed.args[0] === "off" ? "" : parsed.args.join(",");
        try {
          configureDebug({ channels: selector });
        } catch (error) {
          fail(error.message);
        }
        const channels = debug.channels();
        log(channels.length > 0 ? `Debug channels: ${channels.join(", ")}` : "Debug is off.");
        return { ok: true, channels };
      }
      case "use": {
        const id = parsed.args[0];
        if (!id) fail("use needs a composition id, e.g. cg`use voronoi`.");
        const list = listCompositions();
        if (!list.includes(id)) {
          fail(`Unknown composition "${id}". Run cg\`list\` to see the available ids.`);
        }
        useComposition(id);
        log(`Composition: ${activeComposition()}`);
        return { ok: true, composition: activeComposition() };
      }
      case "panel":
      case "ui":
      case "tab": {
        const action = panelAction(parsed);
        const visible = action === "toggle" ? !isPanelVisible() : action === "show";
        setPanelVisible(visible);
        log(`Export panel ${isPanelVisible() ? "visible" : "hidden"}.`);
        return { ok: true, panelVisible: isPanelVisible() };
      }
      case "export":
        return runExportCommand(parsed);
      case "":
        log(CONSOLE_HELP);
        return { ok: true, help: CONSOLE_HELP };
      default:
        return fail(`Unknown command "${parsed.name}". Run cg\`help\` for the command list.`);
    }
  }

  // Accepts both call styles: cg`export --mp4` and cg("export --mp4").
  async function run(input, ...values) {
    const command = Array.isArray(input) && Array.isArray(input.raw)
      ? input.raw.map((part, index) => part + (index < values.length ? values[index] : "")).join("")
      : input;
    try {
      return await dispatch(parseCommandLine(command));
    } catch (error) {
      log(`Error: ${error.message}`);
      return { ok: false, error: error.message };
    }
  }

  run.help = () => run("help");
  run.list = () => run("list");
  run.status = () => run("status");
  run.panel = action => run(`panel ${action ?? "toggle"}`);
  run.export = flags => run(`export ${flags ?? ""}`);

  return run;
}
