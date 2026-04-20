// @gcu/pyskit — <script type="adder"> for vanilla HTML pages.
// A thin DOM shim over @gcu/adder. See SPEC.md for the full specification.
//
// Two execution engines are shipped:
//
//   • 'air' (default) — transpile adder → AIR → V8-hinted JS, execute.
//     Faster, especially for numeric code. No acorn needed (adder's own
//     parser is used; only JS sources would need acorn, and we don't parse JS).
//
//   • 'walker' — run adder's tree-walking evaluator directly.
//     Slower, but errors carry precise adder-source line info. Good for dev.
//
// Per-block override:   <script type="adder" walker>     ← use tree-walker for this block
// Page-level override:  <meta name="pyskit-engine" content="walker">

// Tree-walker path
import { adderParse } from '@gcu/adder/parse';
import { adderEval, AdderScope } from '@gcu/adder/eval';
import { adderBuiltins, pyRepr, adderModules } from '@gcu/adder/builtins';

// AIR path
import { _py } from '@gcu/adder/runtime';
import { lowerAdder } from '@gcu/air/lower/adder';
import { runPasses } from '@gcu/air/passes';
import { emitJS, needsAsync } from '@gcu/air/emit';

const VERSION = '0.1.0';
const _AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// ── module-scope state ──

let _scope = null;        // shared AdderScope — source of truth for both engines
let _blockIndex = 0;      // 1-based block counter (for error labels)
let _defaultEngine = 'air'; // overridden at boot by <meta name="pyskit-engine">
const _loadCache = {};
const _boundEvents = new WeakMap();
let _booted = false;

// Mutable I/O targets. Adder's `print` builtin formats its args (sep / end
// handling, pyStr coercion for each value) and calls this target with the
// final string. Same for display. We keep the print builtin stable — replacing
// it with a per-block writer would drop the multi-arg formatting — and swap
// these callbacks as needed per block to route to the right output element.
let _printTarget = (s) => { try { console.log(s.replace(/\n$/, '')); } catch {} };
let _displayTarget = (v) => { try { console.log(pyRepr(v)); } catch {} };

// JS intrinsics resolve via the ambient global; we don't pass them as
// scope parameters to AIR-emitted functions (would shadow the globals).
const _JS_INTRINSICS = new Set([
  'Math', 'console', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean',
  'Date', 'RegExp', 'Error', 'TypeError', 'RangeError',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Symbol',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'NaN', 'Infinity',
  'Int8Array', 'Uint8Array', 'Int16Array', 'Uint16Array',
  'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array',
  'ArrayBuffer', 'DataView', 'globalThis',
  'document', 'window', 'fetch', 'setTimeout', 'setInterval',
  'clearTimeout', 'clearInterval', 'Element', 'alert', 'Promise',
]);

// ── @-prefix module alias table ──

const _moduleAliases = {
  '@natra':         'https://esm.sh/@gcu/natra',
  '@plot':          'https://esm.sh/@gcu/plot',
  '@sadpan':        'https://esm.sh/@gcu/sadpan',
  '@gcu/bearing':   'https://esm.sh/@gcu/bearing',
  '@gcu/spinifex':  'https://esm.sh/@gcu/spinifex',
  '@gcu/calque':    'https://esm.sh/@gcu/calque',
  '@gcu/gslib':     'https://esm.sh/@gcu/gslib',
  '@gcu/raster':    'https://esm.sh/@gcu/raster',
  '@gcu/alpack':    'https://esm.sh/@gcu/alpack',
  '@gcu/units':     'https://esm.sh/@gcu/units',
  '@gcu/sheet':     'https://esm.sh/@gcu/sheet',
  '@gcu/vfs':       'https://esm.sh/@gcu/vfs',
};

async function load(url) {
  if (_loadCache[url]) return _loadCache[url];
  const resolved = _moduleAliases[url] || url;
  const mod = await import(/* @vite-ignore */ resolved);
  _loadCache[url] = mod.default ?? mod;
  return _loadCache[url];
}

// ── utilities ──

function dedent(code) {
  if (!code || code.indexOf('\n') === -1) return code;
  const lines = code.split('\n');
  let min = Infinity;
  for (const line of lines) {
    if (!line.trim()) continue;
    const n = line.match(/^[ \t]*/)[0].length;
    if (n < min) min = n;
    if (min === 0) break;
  }
  if (!Number.isFinite(min) || min === 0) return code;
  return lines.map(l => l.slice(min)).join('\n');
}

function trimEdges(s) {
  return (s || '').replace(/^\n+/, '').replace(/\n+$/, '');
}

// ── styles ──

function injectStyles() {
  if (document.getElementById('pyskit-styles')) return;
  const style = document.createElement('style');
  style.id = 'pyskit-styles';
  style.textContent = `
pyskit-output, pyskit-error {
  display: block;
  white-space: pre-wrap;
  font-family: ui-monospace, Menlo, Monaco, Consolas, "Courier New", monospace;
  font-size: 13px;
  line-height: 1.5;
  padding: 0.5em 0.75em;
  margin: 0.25em 0;
}
pyskit-output:empty, pyskit-error:empty { display: none; }
pyskit-output {
  background: rgba(0, 0, 0, 0.03);
  border-radius: 3px;
}
pyskit-error {
  color: #b00020;
  background: rgba(176, 0, 32, 0.05);
  border-left: 3px solid currentColor;
}
@media (prefers-color-scheme: dark) {
  pyskit-output { background: rgba(255, 255, 255, 0.03); }
  pyskit-error  { color: #f88; background: rgba(248, 136, 136, 0.06); }
}
script[type="adder"] { display: none; }
`;
  document.head.appendChild(style);
}

// ── scope ──
//
// AdderScope is the source of truth. The tree-walker uses it natively.
// The AIR path reads free-name values via scope.get(name) and writes
// defined-name values back via scope.set(name, value). This keeps both
// engines in lockstep so blocks can mix engines freely on the same page.

function createScope() {
  const scope = new AdderScope();

  // The `print` builtin formats its ...args and calls the routedPrint
  // function with the final string — which forwards to the mutable
  // _printTarget. Per-block target swapping (see executeBlock) redirects
  // output to the correct <pyskit-output> without replacing print itself.
  const routedPrint   = (s) => _printTarget(s);
  const routedDisplay = (v) => _displayTarget(v);
  const builtins = adderBuiltins(routedPrint);
  for (const [k, v] of Object.entries(builtins)) scope.set(k, v);
  scope.set('display', routedDisplay);

  const bind = (fn) => typeof fn === 'function' ? fn.bind(globalThis) : fn;
  const browser = {
    document, window, console,
    fetch:          bind(globalThis.fetch),
    setTimeout:     bind(globalThis.setTimeout),
    clearTimeout:   bind(globalThis.clearTimeout),
    setInterval:    bind(globalThis.setInterval),
    clearInterval:  bind(globalThis.clearInterval),
    JSON, Promise, Element,
    alert:          bind(globalThis.alert),
    querySelector:  (sel) => document.querySelector(sel),
    querySelectorAll: (sel) => [...document.querySelectorAll(sel)],
    load,
  };
  for (const [k, v] of Object.entries(browser)) {
    if (v !== undefined) scope.set(k, v);
  }

  // Override sys.platform and sys.path in adder's module registry so
  // `import sys` inside adder code sees our pyskit overrides. Scope lookup
  // of `sys` would throw NameError — sys is a module, not a builtin; it only
  // enters scope via an explicit import statement.
  if (adderModules && adderModules.sys) {
    adderModules.sys.platform = 'pyskit';
    adderModules.sys.path = ['./'];
  }

  return scope;
}

// ── output / error elements ──

function ensureOutputFor(scriptEl) {
  const targetId = scriptEl.getAttribute('output');
  if (targetId) {
    const el = document.getElementById(targetId);
    if (el) return el;
    console.warn(`pyskit: output="${targetId}" has no matching element`);
  }
  const next = scriptEl.nextElementSibling;
  if (next && next.tagName && next.tagName.toLowerCase() === 'pyskit-output') return next;
  const out = document.createElement('pyskit-output');
  scriptEl.parentNode.insertBefore(out, scriptEl.nextSibling);
  return out;
}

function placeErrorAfter(scriptEl) {
  let anchor = scriptEl.nextElementSibling;
  if (!anchor || anchor.tagName?.toLowerCase() !== 'pyskit-output') anchor = scriptEl;
  const err = document.createElement('pyskit-error');
  anchor.parentNode.insertBefore(err, anchor.nextSibling);
  return err;
}

function labelFor(scriptEl, index) {
  if (scriptEl.hasAttribute('src')) return scriptEl.getAttribute('src');
  if (scriptEl.hasAttribute('id'))  return '#' + scriptEl.getAttribute('id');
  return `block ${index}`;
}

function formatError(err, label) {
  if (err && err.pyType) {
    const line = err.adderLine != null ? `, line ${err.adderLine}` : '';
    return `${err.pyType}: ${err.pyMessage || err.message || ''} (${label}${line})`;
  }
  const name = err?.name || 'Error';
  const msg  = err?.message || String(err);
  return `${name}: ${msg} (${label})`;
}

// These are installed as the _printTarget / _displayTarget while a block
// executes. They write into the block's output element. adder's print has
// already done all the multi-arg formatting by the time blockPrintFor's
// function is called — we just append the final string.
function blockPrintFor(outputEl) {
  return (s) => outputEl.appendChild(document.createTextNode(s));
}

function blockDisplayFor(outputEl) {
  return (value) => {
    if (value == null) return;
    if (value instanceof Element || value instanceof DocumentFragment) {
      outputEl.appendChild(value);
    } else {
      outputEl.appendChild(document.createTextNode(pyRepr(value) + '\n'));
    }
  };
}

// ── engine resolution ──
//
// Any element (a <script type="adder"> block, or an element with an adder-*
// event attribute) may carry `walker` or `air` to pin its engine. Otherwise
// _defaultEngine is used — which is 'air' unless overridden by a page-level
// <meta name="pyskit-engine" content="walker"> at boot, or by the `engine`
// field in a <script type="pyskit-config"> block.

function engineForElement(el) {
  if (el.hasAttribute('walker')) return 'walker';
  if (el.hasAttribute('air'))    return 'air';
  return _defaultEngine;
}

function resolveDefaultEngine() {
  const meta = document.querySelector('meta[name="pyskit-engine"]');
  const val = meta?.getAttribute('content')?.trim().toLowerCase();
  if (val === 'walker' || val === 'air') _defaultEngine = val;
}

// ── config block ──
//
// A single <script type="pyskit-config"> element (if present) configures the
// runtime at boot, before any <script type="adder"> block executes. JSON only.
// See SPEC.md §12 for the schema.

async function applyConfig() {
  const configEl = document.querySelector('script[type="pyskit-config"]');
  if (!configEl) return;

  let config;
  try {
    config = JSON.parse(configEl.textContent);
  } catch (e) {
    console.error('pyskit: <script type="pyskit-config"> is not valid JSON —', e.message);
    return;
  }
  if (!config || typeof config !== 'object') {
    console.warn('pyskit: pyskit-config content must be a JSON object, skipping');
    return;
  }

  // engine — overrides the meta-tag default.
  if (config.engine === 'walker' || config.engine === 'air') {
    _defaultEngine = config.engine;
  }

  // aliases — extend (or override) the @-prefix module alias table used by load().
  if (config.aliases && typeof config.aliases === 'object') {
    Object.assign(_moduleAliases, config.aliases);
  }

  // cdn — override the CDN base for @gcu/* aliases. Rewrites any alias currently
  // pointing at https://esm.sh/ to the new base. After this runs, `load("@natra")`
  // fetches from the configured CDN instead of esm.sh.
  if (typeof config.cdn === 'string' && config.cdn) {
    const base = config.cdn.endsWith('/') ? config.cdn : config.cdn + '/';
    for (const [key, val] of Object.entries(_moduleAliases)) {
      if (val.startsWith('https://esm.sh/')) {
        _moduleAliases[key] = base + val.slice('https://esm.sh/'.length);
      }
    }
  }

  // sysPath — replaces the default sys.path (which pyskit sets to ['./']).
  if (Array.isArray(config.sysPath) && adderModules?.sys) {
    adderModules.sys.path = config.sysPath.slice();
  }

  // packages — preload these via load() before any adder block runs, so
  // blocks can reference them as already-loaded globals if desired.
  // Preloads run in parallel; individual failures log a warning but don't
  // block boot (a broken CDN URL shouldn't take down the whole page).
  if (Array.isArray(config.packages)) {
    const results = await Promise.allSettled(
      config.packages.map((p) => load(p))
    );
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.warn(
          `pyskit: preload "${config.packages[i]}" failed —`,
          r.reason?.message || r.reason
        );
      }
    });
  }
}

// ── engine: tree-walker ──
// The easy path — adderEval operates on the shared AdderScope directly.

async function runBlockWalker(code) {
  const ast = adderParse(code);
  await adderEval(ast, _scope);
}

// ── engine: AIR ──
// Compile adder → JS, wrap in a Function, call with _py + values pulled from
// the shared scope for each free name. Merge defined names back into the shared
// scope afterward so subsequent blocks see them.

async function runBlockAir(code) {
  const air = lowerAdder(adderParse(code), code);
  runPasses(air);

  // Only pass free names that are actually in scope; let JS intrinsics
  // (Math, JSON, etc.) resolve via the ambient global scope. Use the
  // scope.vars Map directly — scope.get throws NameError on missing names.
  const imports = [...(air.imports || [])].filter(
    n => !_JS_INTRINSICS.has(n) && _scope.vars?.has(n)
  );
  const scopeKeys = ['_py', ...imports];
  const jsBody = emitJS(air, scopeKeys, []);
  const Ctor = needsAsync(air) ? _AsyncFunction : Function;
  const fn = new Ctor(...scopeKeys, jsBody);

  const args = [_py, ...imports.map(n => _scope.vars?.get(n))];
  const defined = await fn(...args);

  // Merge defined names back into the shared scope so later blocks see them.
  if (defined && typeof defined === 'object') {
    for (const k of Object.keys(defined)) _scope.set(k, defined[k]);
  }
}

// ── block execution ──

async function fetchSrc(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`pyskit: fetch ${url} failed (${resp.status})`);
  return await resp.text();
}

async function executeBlock(scriptEl, index) {
  if (scriptEl.hasAttribute('worker')) {
    console.warn('pyskit: worker blocks are not yet implemented (spec §5.6); skipping this block');
    return;
  }

  let code = scriptEl.hasAttribute('src')
    ? await fetchSrc(scriptEl.getAttribute('src'))
    : scriptEl.textContent;
  code = trimEdges(dedent(code || ''));
  if (!code) return;

  const outputEl = ensureOutputFor(scriptEl);
  const prevPrintTarget   = _printTarget;
  const prevDisplayTarget = _displayTarget;
  _printTarget   = blockPrintFor(outputEl);
  _displayTarget = blockDisplayFor(outputEl);

  const engine = engineForElement(scriptEl);

  try {
    if (engine === 'walker') {
      await runBlockWalker(code);
    } else {
      await runBlockAir(code);
    }
  } catch (e) {
    const errEl = placeErrorAfter(scriptEl);
    errEl.textContent = formatError(e, labelFor(scriptEl, index));
  } finally {
    _printTarget   = prevPrintTarget;
    _displayTarget = prevDisplayTarget;
  }
}

// ── event attribute binding ──

const EVENT_ATTRS = [
  'click', 'dblclick',
  'mousedown', 'mouseup', 'mouseover', 'mouseout',
  'input', 'change', 'submit',
  'keydown', 'keyup', 'keypress',
  'focus', 'blur',
  'touchstart', 'touchend',
];

// Per-(element, attribute) cache of compiled/parsed handlers. Events like
// `adder-input` fire on every keystroke; without this we'd parse and lower
// the handler source on every fire. With this, the compile cost is paid once
// and subsequent invocations just run the cached function/AST.
const _handlerCache = new WeakMap();

function compileHandler(code, engine) {
  const src = trimEdges(dedent(code));
  if (engine === 'walker') {
    return { engine, ast: adderParse(src) };
  }
  const air = lowerAdder(adderParse(src), src);
  runPasses(air);
  const imports = [...(air.imports || [])].filter(
    n => !_JS_INTRINSICS.has(n)
  );
  const scopeKeys = ['_py', ...imports];
  const jsBody = emitJS(air, scopeKeys, []);
  const isAsync = needsAsync(air);
  const Ctor = isAsync ? _AsyncFunction : Function;
  return { engine, fn: new Ctor(...scopeKeys, jsBody), imports, isAsync };
}

function getHandler(el, attr, engine) {
  let cache = _handlerCache.get(el);
  if (!cache) { cache = new Map(); _handlerCache.set(el, cache); }
  const key = attr + '|' + engine;
  let entry = cache.get(key);
  if (entry) return entry;
  entry = compileHandler(el.getAttribute(attr), engine);
  cache.set(key, entry);
  return entry;
}

async function runHandler(el, event, attr, ev) {
  const engine = engineForElement(el);
  try {
    const entry = getHandler(el, attr, engine);
    _scope.set('event', ev);
    _scope.set('this_element', el);
    if (entry.engine === 'walker') {
      await adderEval(entry.ast, _scope);
    } else {
      const args = [_py, ...entry.imports.map(n => _scope.vars?.get(n))];
      const result = entry.fn(...args);
      const defined = entry.isAsync ? await result : result;
      if (defined && typeof defined === 'object') {
        for (const k of Object.keys(defined)) _scope.set(k, defined[k]);
      }
    }
  } catch (e) {
    const name = e?.pyType || e?.name || 'Error';
    const msg  = e?.pyMessage || e?.message || String(e);
    console.error(`pyskit [${attr}]: ${name}: ${msg}`);
  }
}

function bindOne(el, event, attr) {
  let bound = _boundEvents.get(el);
  if (!bound) { bound = new Set(); _boundEvents.set(el, bound); }
  if (bound.has(attr)) return;
  bound.add(attr);
  el.addEventListener(event, (ev) => { runHandler(el, event, attr, ev); });
}

function bindEventAttributes(root) {
  const isEl = root && root.nodeType === 1;
  for (const event of EVENT_ATTRS) {
    const attr = 'adder-' + event;
    if (isEl && root.hasAttribute?.(attr)) bindOne(root, event, attr);
    const nodes = (root.querySelectorAll ? root.querySelectorAll(`[${attr}]`) : []);
    for (const el of nodes) bindOne(el, event, attr);
  }
}

// ── mutation observer ──

function startObserver() {
  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'SCRIPT' && node.getAttribute('type') === 'adder') {
          executeBlock(node, ++_blockIndex).catch(err => {
            console.error('pyskit: dynamic block error:', err);
          });
        }
        bindEventAttributes(node);
      }
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
  return obs;
}

// ── boot ──

async function boot() {
  if (_booted) return;
  _booted = true;

  resolveDefaultEngine();
  injectStyles();
  _scope = createScope();
  await applyConfig();

  const blocks = document.querySelectorAll('script[type="adder"]');
  for (const script of blocks) {
    _blockIndex++;
    await executeBlock(script, _blockIndex);
  }

  bindEventAttributes(document);
  startObserver();

  window.pyskit = {
    get scope() { return _scope; },
    get defaultEngine() { return _defaultEngine; },
    set defaultEngine(v) {
      if (v !== 'air' && v !== 'walker') {
        throw new Error(`pyskit: unknown engine "${v}" (expected 'air' or 'walker')`);
      }
      _defaultEngine = v;
    },
    async exec(code, opts) {
      const engine = (opts && opts.engine) || _defaultEngine;
      const src = trimEdges(dedent(code));
      if (engine === 'walker') {
        const ast = adderParse(src);
        return await adderEval(ast, _scope);
      }
      return await runBlockAir(src);
    },
    load,
    version: VERSION,
  };

  window.dispatchEvent(new CustomEvent('pyskit:ready'));
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}

export { boot, load, dedent, createScope, VERSION };
