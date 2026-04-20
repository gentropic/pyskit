# pyskit — specification

**`<script type="adder">` for vanilla HTML pages.**

A thin DOM shim over [@gcu/adder](https://www.npmjs.com/package/@gcu/adder) that makes Python-flavored scripting work in plain HTML. No build step, no config, no WASM, no cold start. One `<script>` include, then write adder blocks inline.

- **Package:** `@gcu/pyskit`
- **Repository:** `github.com/gentropic/pyskit`
- **Runtime dependency:** `@gcu/adder` (interpreter core — `/parse`, `/eval`, `/builtins` subpaths)

---

## 1. Positioning

### 1.1 What this replaces

PyScript offers two interpreter backends: Pyodide (full CPython, ~11 MB, numpy/pandas/scipy) and MicroPython (~170 KB, no scientific stack). Pyskit targets the same niche as PyScript+MicroPython — lightweight Python syntax in the browser — but with key advantages:

| | PyScript + MicroPython | pyskit |
|---|---|---|
| size | ~170 KB interpreter WASM | ~35 KB total (interpreter + shim) |
| cold start | WASM compile + init | instant (pure JS) |
| FFI | JS↔WASM proxy objects | none — values ARE JS values |
| async | Asyncify shims | native (evaluator is async JS) |
| arrays/numerics | ✗ | `load("@natra")` |
| plotting | ✗ | `load("@plot")` |
| dataframes | ✗ | `load("@sadpan")` |
| geostatistics | ✗ | `load("@gcu/gslib")` |
| DOM access | via `pyscript.web` proxy | direct `document.*` — it's JS underneath |
| packages from PyPI | micropip (very limited) | ✗ — GCU ecosystem only |

MicroPython-backed PyScript gives you Python syntax but no scientific capabilities. Pyskit gives you Python syntax AND a scientific stack — it's just not called numpy/matplotlib/pandas.

### 1.2 What this does NOT replace

Pyodide-backed PyScript (`<script type="py">`) for users who need actual CPython packages — real numpy, real pandas, real scipy, packages from PyPI. If someone needs `import sklearn` or `import sympy`, pyskit is not for them. That's a different weight class entirely.

### 1.3 Package ecosystem

Pyskit can load packages from the GCU ecosystem via `load()`. These are JS-native libraries that work seamlessly with adder because there's no FFI boundary — a natra array IS a JS object, a plot figure IS a DOM element.

Available packages:

| package | provides | Python equivalent |
|---|---|---|
| `@gcu/natra` | ndarray, broadcasting, linear algebra, RNG | numpy |
| `@gcu/plot` | 2D plotting, binds to canvas | matplotlib |
| `@gcu/sadpan` | dataframe operations, TypedArray columns | pandas |
| `@gcu/gslib` | geostatistical algorithms (kriging, simulation) | — |
| `@gcu/bearing` | stereonets, structural geology | mplstereonet |
| `@gcu/spinifex` | browser GIS | — |
| `@gcu/calque` | spreadsheet DSL → XLSX | — |

Loading packages:

```html
<script type="adder">
natra = await load("@natra")
x = natra.linspace(0, 10, 100)
y = natra.sin(x)
</script>
```

The alias table in pyskit.js maps bare `@foo` names to `https://esm.sh/@gcu/foo` URLs; full URLs (including arbitrary CDNs) pass through directly.

### 1.4 JS interop is a noop

Because adder values ARE JS values, every npm package is a native library. There's no FFI, no proxy, no marshalling:

```html
<script type="adder">
d3 = await load("https://esm.sh/d3")
data = [{"x": i, "y": i ** 2} for i in range(20)]
# data is a real JS Array of real JS Objects — d3 doesn't know or care
</script>
```

PyPI has ~500k packages. npm has ~2.5 million. With zero interop cost, they're all yours.

---

## 2. Goals

- A single `<script>` tag to include. No setup ceremony.
- `<script type="adder">` blocks execute in document order.
- Shared scope across all blocks on the page.
- `print()` renders to the DOM, next to the script block.
- Event attributes (`adder-click`, `adder-input`, etc.) for declarative interactivity.
- Full browser API access — `document`, `fetch`, `setTimeout`, etc.
- Package loading from the GCU ecosystem via `load()`.
- Multi-file projects via `import` — fetches `.py` files over HTTP, no server config. (Depends on adder §4.5 / §4.6.)
- Worker blocks — `<script type="adder" worker>` for off-main-thread computation. (v0.2.)
- External source files via `src` attribute.
- Errors shown inline, not just in console.
- Dynamic blocks (added after page load) auto-execute.
- Total bundle under 40 KB gzipped (interpreter + shim, before packages).

## 3. Non-goals

- Not a framework. No component model, no virtual DOM, no reactivity system.
- No pip, no micropip, no PyPI. Packages come from the GCU ecosystem.
- No TOML/JSON config file. If you need config, use a `<script type="adder">` block.
- No attempt to polyfill CPython stdlib beyond what adder already provides.
- No VFS by default. Support is opt-in if someone brings their own.
- No notebook features (DAG, cells, reactive updates). That's Auditable.

---

## 4. Architecture

### 4.1 Repository layout

```
pyskit/
  SPEC.md          — this file
  README.md        — public-facing
  LICENSE          — MIT
  package.json     — @gcu/pyskit, depends on @gcu/adder
  build.js         — esbuild-driven bundle step
  src/
    pyskit.js      — the DOM shim (~350 lines)
  dist/            — build outputs (gitignored, shipped in npm tarball)
    pyskit.bundle.js
    pyskit.bundle.min.js
  example/
    index.html     — demo page
  test/            — unit + integration tests (node --test / playwright)
```

### 4.2 Build

`pyskit.js` imports from `@gcu/adder` via subpath-specific entries (to maximize tree-shaking):

```js
import { adderParse } from '@gcu/adder/parse';
import { adderEval, AdderScope } from '@gcu/adder/eval';
import { adderBuiltins, pyRepr } from '@gcu/adder/builtins';
```

`build.js` runs esbuild with `bundle: true, format: 'iife', platform: 'browser'` to produce a single self-executing file. Two artifacts:

- `dist/pyskit.bundle.js` — readable, for development
- `dist/pyskit.bundle.min.js` — minified, for production (must gzip under 40 KB)

The IIFE format avoids polluting global scope with adder internals. Only `window.pyskit` and the `<script type="adder">` processing are externally visible.

### 4.3 What adder must expose

For pyskit to do its job, these names need to be importable from `@gcu/adder` via their subpaths:

| Symbol | Subpath | Purpose |
|---|---|---|
| `adderParse(code)` | `/parse` | Parse source → AST |
| `adderEval(ast, scope)` | `/eval` | Evaluate AST (async) |
| `AdderScope` | `/eval` | LEGB scope chain |
| `AdderError` | `/eval` or via error bubble | For `pyType` / `pyMessage` / `adderLine` display |
| `adderBuiltins(printFn)` | `/builtins` | Built-in functions + modules object |
| `pyRepr(value)` | `/builtins` | Python-style repr() for display() fallback |

All of these are exported today from `@gcu/adder@0.2.0`. No coordination needed.

### 4.4 Module loading (`load()`)

Lightweight ES-module loader exposed to adder scope:

```js
const _loadCache = {};
async function load(url) {
  if (_loadCache[url]) return _loadCache[url];
  const resolved = _moduleAliases[url] || url;
  const mod = await import(resolved);
  _loadCache[url] = mod.default ?? mod;
  return _loadCache[url];
}
```

The `@`-prefix alias table (in `pyskit.js`) maps known GCU packages to `https://esm.sh/@gcu/<name>`. Any full URL passes through directly. No `/// module:` notion, no persistent installed-module storage — pyskit has no notebook save system.

### 4.5 HTTP module imports

In Auditable, `import foo` resolves via: (1) built-in `adderModules`, (2) `window._auditableExtensions`, (3) VFS search along `sys.path`. Pyskit adds a fourth resolution step — **HTTP fetch along `sys.path`** — which works without VFS.

When a module is not found in built-ins or extensions, iterate `sys.path` entries treating each as a URL base (relative to the page). For each entry, try `fetch(base + name + ".py")`, then `fetch(base + name + "/__init__.py")`. First successful response is parsed and evaluated in a fresh scope; the result is cached in `sys.modules`.

**Default `sys.path`:** Pyskit overrides adder's default `sys.path` to `["./"]` — relative to the HTML page. So `import utils` tries `./utils.py` out of the box.

**User extension:**

```html
<script type="adder">
import sys
sys.path.append("./lib/")
sys.path.append("https://example.com/pylibs/")

import mylib
from helpers import process
</script>
```

**Resolution order (complete):**

1. String literal path (§4.6) — fetch directly, bypass search
2. Built-in `adderModules` (math, json, random, etc.)
3. `window._auditableExtensions` (empty outside Auditable)
4. `sys.modules` cache
5. VFS search along `sys.path` (if VFS available)
6. HTTP fetch along `sys.path` (try `name.py`, then `name/__init__.py`)
7. Otherwise → `ModuleNotFoundError`

**Implementation notes:**

- This feature lives in **adder**, not pyskit. It hooks into adder's existing `_loadVfsModule` pattern: same interface (search `sys.path`, parse, evaluate, cache), different I/O (`fetch()` instead of `vfs.readFile()`). Active when `typeof fetch !== 'undefined'`.
- adder's evaluator is fully async, so `import foo` can internally `await fetch()` with no special handling.
- Failed fetches (404, network error) are silently skipped; only if ALL entries fail does it throw `ModuleNotFoundError`.
- Circular imports handled via `sys.modules` cache placeholder.
- `file://` protocol may or may not work depending on browser — known limitation; use a local dev server.

### 4.6 String literal imports

Adder extends standard `import`/`from` to accept string literals as module paths — direct URLs or relative paths that bypass `sys.path`:

```python
import "https://example.com/lib/vectors.py" as vectors
from "./lib/utils.py" import process, validate
from "https://cdn.example.com/helpers.py" import *

# relative paths resolve relative to the current page (pyskit) or VFS cwd (auditable)
import "./vendor/compat.py" as compat
```

**This is an adder language extension, implemented in adder's parser and evaluator** (`parse.js` / `eval.js`) so it works in Auditable cells, tagged templates, and pyskit blocks alike. The parser change is minimal: after `import` or `from`, if the next token is `STRING` instead of `NAME`, treat it as a direct path.

**Syntax:**

```
import STRING as NAME
from STRING import NAME [, NAME ...]
from STRING import *
```

The `as` alias is required for bare `import STRING` (no natural name can be derived from a URL).

**Resolution:**

1. If the string is an absolute URL (`https://`, `http://`), `fetch()` it directly.
2. If the string is a relative path (`./`, `../`), resolve relative to the current context:
   - In pyskit: relative to the HTML page
   - In Auditable with VFS: relative to VFS cwd, tried via `vfs.readFile()` first, then `fetch()`
   - In Auditable without VFS: relative to the page via `fetch()`
3. Parse the fetched source, evaluate in a fresh scope, cache in `sys.modules` keyed by the resolved URL.

String imports are for `.py` (adder) source only. For JS/ES modules, use `load()`. The distinction is crisp: `import "..."` = adder code, `load("...")` = JS code.

### 4.7 No install()

`install()` (Auditable's feature that embeds module source in the HTML for offline use) depends on the notebook save system. Pyskit doesn't have a save system, so `install()` is not provided. Users who need offline support should use a bundler, a service worker, or a CDN cache.

### 4.8 Implementation boundary — which codebase owns what

| Feature | Lives in |
|---|---|
| `<script type="adder">` interception, boot, output elements, event attributes, MutationObserver | **pyskit** |
| `load()` with `@`-prefix alias resolution | **pyskit** |
| Scope pre-population with browser globals | **pyskit** |
| `sys.platform = 'pyskit'`, `sys.path = ['./']` overrides | **pyskit** |
| Worker block execution (§5.6) | **pyskit** |
| Error display with block identification (§8.1) | **pyskit** |
| String literal imports (§4.6) — parser + evaluator changes | **adder** |
| HTTP fetch module loader (§4.5) | **adder** |

String imports and HTTP imports are adder language features. They benefit Auditable cells and adder tagged templates too. Pyskit's job is the DOM shim around adder; the language itself is adder's job.

---

## 5. Execution model

### 5.1 Boot sequence

1. Bundle loaded via `<script src="dist/pyskit.bundle.min.js">` (or the dev build).
2. On `DOMContentLoaded` (or immediately if already loaded), pyskit:
   a. Injects `<style>` for `pyskit-output` and `pyskit-error` elements.
   b. Creates the shared `AdderScope` with builtins + browser globals.
   c. Overrides `sys.platform` to `'pyskit'` (adder's default is `'auditable'`). Overrides `sys.path` to `['./']`.
   d. Collects all `<script type="adder">` elements in document order.
   e. Executes each block sequentially (`await` between blocks — order matters).
   f. Scans the DOM for `adder-*` event attributes and binds them.
   g. Starts a `MutationObserver` for dynamically added blocks and event attributes.
   h. Dispatches `window` event `pyskit:ready`.

Code can detect the runtime environment via `sys.platform`:

```python
import sys
if sys.platform == 'pyskit':
    print("running in pyskit")
elif sys.platform == 'auditable':
    print("running in auditable")
```

### 5.2 Shared scope

All blocks share a single `AdderScope` instance — the "global" scope for the page.

Pre-populated with:

**Adder builtins** — everything `adderBuiltins(printFn)` returns: `print`, `len`, `range`, `int`, `float`, `str`, `list`, `dict`, `set`, `sorted`, `enumerate`, `zip`, `map`, `filter`, `isinstance`, `hasattr`, etc., plus built-in modules (`math`, `json`, `random`, `itertools`, `functools`, `collections`, `re`, `string`, `sys`).

**Browser globals:**

| Name | Value |
|---|---|
| `document`, `window`, `console` | as provided by the browser |
| `fetch`, `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`, `alert` | bound to the window |
| `JSON`, `Promise`, `Element` | as provided |
| `load` | module loader (§4.4) |

**Convenience shortcuts:**

| Name | Value |
|---|---|
| `querySelector(sel)` | `document.querySelector(sel)` |
| `querySelectorAll(sel)` | `[...document.querySelectorAll(sel)]` (returns list, not NodeList) |

This list is intentionally minimal. Users have `document` and `window`; they can reach anything.

### 5.3 Block execution

For each `<script type="adder">` block:

1. **Get code.** If `src` attribute present, `await fetch(src)`; otherwise use `scriptEl.textContent`.
2. **Dedent.** Strip common leading whitespace.
3. **Skip empty.** If code is blank after dedent, skip.
4. **Override `print()`** for this block — route to its output element (§6).
5. **Override `display()`** for this block — append DOM elements or text to the output element.
6. **Parse.** `adderParse(code)` → AST. On `SyntaxError`, show error (§8) and continue.
7. **Evaluate.** `await adderEval(ast, scope)`. Shared scope means assignments persist.
8. **On error,** show error inline (§8) and continue. One broken block should not kill the page.

**Supported attributes on `<script type="adder">`:**

| Attribute | Purpose |
|---|---|
| `src` | Fetch code from URL instead of inline (§5.4) |
| `output` | Route print/display to element with this ID (§6.2) |
| `worker` | Run in a Web Worker (§5.6) |
| `id` | Block identifier — used in error messages (§8.1) |

### 5.4 External source

```html
<script type="adder" src="app.py"></script>
```

`src` fetches the file. The response must be `ok`. Fetched code is used for execution (replaces `textContent`). Relative URLs resolve relative to the HTML page.

### 5.5 Async

The evaluator is async. `await` works at top level and inside `async def`:

```html
<script type="adder">
response = await fetch("https://api.example.com/data")
data = await response.json()
print(data)
</script>
```

### 5.6 Worker blocks

`<script type="adder" worker>` runs the block off the main thread in a Web Worker. The interpreter is pure JS — no WASM to re-initialize. The worker receives the source code, parses and evaluates, and posts back the results.

```html
<script type="adder" worker>
data = [i ** 2 for i in range(1_000_000)]
result = sum(data)
heavy = {i: i ** 3 for i in range(10000)}
</script>

<!-- next block runs on main thread, sees `result` and `heavy` -->
<script type="adder">
print(f"result: {result}")
</script>
```

**What works in workers:** all adder language features, built-in modules, `fetch()`, `import` of built-in modules and HTTP imports (§4.5, §4.6), `load()` for ES modules.

**What does NOT:** `document`, `window`, `Element`, `alert`, `querySelector`, `querySelectorAll`, `display()`. `print()` is buffered and flushed to the output element when the worker completes. Rule: **workers compute, the main thread displays.**

**Implementation:**

1. On encountering `<script type="adder" worker>`, pyskit creates a blob URL from the interpreter core source (cached after first use).
2. Structured-cloneable values from the shared scope are serialized and sent via `postMessage`. Functions, DOM elements, and other non-cloneable values are skipped.
3. Worker creates a fresh `AdderScope` with builtins (minus DOM globals) + received upstream values, then parses and evaluates.
4. `print()` calls buffered as strings inside the worker.
5. On completion the worker posts back: (a) defined names + values (structured clone), (b) buffered print output, or (c) error details.
6. The main thread merges defined names into the shared scope, flushes print output to `<pyskit-output>`, and continues.
7. On error, display inline (§8) and continue.

**Sequencing:** worker blocks are awaited — the next block does not execute until the worker finishes and its results are merged. Workers are for non-blocking UI within a block, not for parallel execution across blocks.

**Scope transfer limitations:**

| Type | Transfers? |
|---|---|
| numbers, strings, booleans, null | ✓ |
| Arrays, plain Objects | ✓ (deep copy) |
| Maps, Sets | ✓ |
| TypedArrays | ✓ (can be transferred zero-copy) |
| Functions, classes | ✗ skipped (source-only retransmit later?) |
| DOM elements | ✗ skipped |
| adder class instances | ✓ as plain objects (lose class identity) |

TypedArrays can be transferred zero-copy via `postMessage` transfer list — the worker side marks large TypedArrays for transfer rather than copying (threshold is implementation detail, e.g., >1 KB).

---

## 6. Output

### 6.1 Default output

Each `<script type="adder">` block gets a `<pyskit-output>` element. On first `print()`/`display()`:

1. If the block's next sibling is already a `<pyskit-output>`, use it.
2. Otherwise, create one and insert it after the `<script>` tag.

`print()` appends text nodes. The element has `white-space: pre-wrap` and monospace font.

### 6.2 Targeted output

```html
<div id="results"></div>
<script type="adder" output="results">
print("goes here")
</script>
```

`output` is an element ID. `print()` and `display()` output goes to that element instead of creating a `<pyskit-output>`.

### 6.3 display()

`display(value)` is available in every block:

- If `value` is an `Element` or `DocumentFragment`, append directly.
- Otherwise, convert via `pyRepr()` and append as text.

Useful for DOM:

```html
<script type="adder">
el = document.createElement("canvas")
el.width = 200
el.height = 200
ctx = el.getContext("2d")
ctx.fillStyle = "coral"
ctx.fillRect(10, 10, 180, 180)
display(el)
</script>
```

And for GCU packages that return DOM elements:

```html
<script type="adder">
plot = await load("@plot")
fig = plot.figure(400, 300)
fig.plot(x, y)
display(fig.el)
</script>
```

---

## 7. Event attributes

### 7.1 Syntax

```html
<button adder-click="handler()">click me</button>
<input adder-input="on_change()" adder-keydown="on_key()">
```

The attribute value is adder source code. It is parsed and evaluated in the shared scope when the event fires.

### 7.2 Supported events

```
adder-click       adder-dblclick
adder-mousedown   adder-mouseup
adder-mouseover   adder-mouseout
adder-input       adder-change
adder-submit
adder-keydown     adder-keyup     adder-keypress
adder-focus       adder-blur
adder-touchstart  adder-touchend
```

### 7.3 Event context

Before each handler invocation, two names are set on the shared scope:

| Name | Value |
|---|---|
| `event` | The DOM `Event` object |
| `this_element` | The element the attribute is on |

They persist in scope (overwritten by the next event).

### 7.4 Async in handlers

```html
<button adder-click="
resp = await fetch('/api/thing')
data = await resp.json()
document.getElementById('out').textContent = str(data)
">load</button>
```

### 7.5 Binding

Event attributes are bound:

1. After all `<script type="adder">` blocks have executed (so handlers can reference functions defined in blocks).
2. On any DOM mutation that adds elements with `adder-*` attributes (via MutationObserver).

Each element+event pair is bound at most once (tracked via a `Set` on the element). Re-binding the same attribute is a no-op.

---

## 8. Error display

### 8.1 Inline errors

On parse error or runtime error:

1. Create a `<pyskit-error>` element after the block (or after its `<pyskit-output>`).
2. Display the error message with block identification and line number.
3. Continue to the next block. Errors are non-fatal.

**Block identification** — a page may have many blocks. "line 15" alone is ambiguous. Pyskit uses the first available label:

1. `src` attribute value → `"app.py, line 15"`
2. `id` attribute value → `"#data-loader, line 15"`
3. Block index (1-based) → `"block 3, line 15"`

Error format: `"ErrorType: message (source, line N)"`, e.g.:

```
NameError: name 'x' is not defined (app.py, line 15)
NameError: name 'x' is not defined (#data-loader, line 15)
NameError: name 'x' is not defined (block 3, line 15)
```

For non-`AdderError` (native JS errors bubbling through), the plain `name: message` is shown with the block label.

### 8.2 Event handler errors

Logged to `console.error` with a prefix: `pyskit [adder-click]: ErrorType: message`. No inline display — the DOM context where the handler fires doesn't necessarily have an obvious output slot.

### 8.3 Styling

```css
pyskit-error {
  display: block;
  white-space: pre-wrap;
  font-family: monospace;
  font-size: 13px;
  padding: 0.5em 0.75em;
  margin: 0.25em 0;
  border-left: 3px solid;
}
```

Colors adapt to `prefers-color-scheme`. Specifics are implementation detail, not spec.

---

## 9. Styles

Pyskit injects a `<style id="pyskit-styles">` into `<head>` on boot:

- `pyskit-output` — block, pre-wrap, monospace, hidden when empty
- `pyskit-error` — block, pre-wrap, monospace, colored, hidden when empty
- `script[type="adder"]` — `display: none`

Idempotent (checks for existing `#pyskit-styles`). No `!important` — user styles can override.

---

## 10. Dynamic blocks

A `MutationObserver` on `document.body` watches for:

- Added `<script type="adder">` elements → execute them
- Added elements with `adder-*` attributes → bind event handlers

Uses `{ childList: true, subtree: true }`.

---

## 11. JS API

### 11.1 window.pyskit

```js
window.pyskit = {
  scope,          // the shared AdderScope (read-only property)
  exec(code),     // parse + eval in shared scope, returns result (async)
  load(url),      // module loader
  version,        // string, e.g. "0.1.0"
}
```

### 11.2 pyskit.exec(code)

Parses and evaluates `code` in the shared scope. Returns the last expression value. Does not create output elements.

```js
await pyskit.exec('x = 42')
const x = pyskit.scope.get('x')  // 42
```

### 11.3 pyskit:ready event

```js
window.addEventListener('pyskit:ready', () => {
  // all initial <script type="adder"> blocks have executed
})
```

---

## 12. Configuration

A single `<script type="pyskit-config">` element, if present on the page, configures the runtime before any `<script type="adder">` block executes. JSON only — no TOML, no `src="..."` attribute for external files in v0.2. Everything that needs to persist across the page goes here; per-block attributes (`walker`, `air`, `output`, `src`, `worker`, `id`) override for that block.

Only one config block per page. If multiple exist, the first wins and a `console.warn` is emitted for the rest.

### 12.1 Schema

```html
<script type="pyskit-config">
{
  "engine": "air",

  "packages": ["@natra", "@plot"],

  "aliases": {
    "@mylib": "https://example.com/mylib.js",
    "@gcu/plot": "/vendor/@gcu/plot/index.js"
  },

  "sysPath": ["./", "./lib/"],

  "cdn": "https://esm.sh/"
}
</script>
```

All fields are optional.

- **`engine`** — `"air"` or `"walker"`. Sets the default engine for blocks that don't carry a `walker` or `air` attribute. Overrides `<meta name="pyskit-engine">`.
- **`packages`** — array of module identifiers to `load()` in parallel before any block runs. Each entry is resolved the same way `load(...)` resolves from adder code — `@`-prefix aliases go through the alias table; full URLs pass through. Individual preload failures log `console.warn` but don't block boot. Preloaded packages go into pyskit's internal module cache so subsequent `load()` calls for the same name are free.
- **`aliases`** — entries to add to (or override) the built-in `@`-prefix module alias table. Use this to point `@gcu/*` names at a private mirror, to register project-local names like `@mylib`, or to pin a specific version of a package.
- **`sysPath`** — replaces the default `sys.path` (`["./"]`). Used by HTTP imports and (eventually) VFS imports to locate modules.
- **`cdn`** — override the CDN base for `@gcu/*` aliases. After this runs, every existing alias that pointed at `https://esm.sh/` is rewritten to use the new base. Useful for corporate environments or local mirrors.

### 12.2 Execution order

1. Bundle loaded.
2. On `DOMContentLoaded`, pyskit resolves `<meta name="pyskit-engine">` into the engine default.
3. Injects styles, creates the shared `AdderScope` with builtins + browser globals.
4. **Reads `<script type="pyskit-config">` and applies it** — overrides engine default, extends alias table, rewrites CDN base, replaces `sys.path`, preloads `packages` in parallel.
5. Executes each `<script type="adder">` block in document order.
6. Binds event attributes. Starts `MutationObserver`. Dispatches `pyskit:ready`.

Config is applied between scope creation and block execution, so blocks see the configured state (packages already loaded, `sys.path` set, alias table populated) from their first line.

### 12.3 Error behavior

- Invalid JSON in the config block: `console.error`, otherwise boot continues as if the block weren't there.
- Config root is not a JSON object: `console.warn`, boot continues.
- Unknown fields: silently ignored (forward-compatible).
- Invalid values for known fields: silently ignored (logs a warning only if it's a clear mistake like `"engine": "nodejs"`).

Invalid config should never take down the page. Missing or broken config falls back to defaults.

### 12.4 Relationship to the meta tag

`<meta name="pyskit-engine" content="walker">` is a convenience shortcut for the single most common config case (engine default). It still works. If both are present, the config block wins because it's applied later. Use the meta tag for trivial one-line config; use the config block when you need anything more.

---

## 13. Deployment

### 13.1 Size budget

| Component | Approximate (gzipped) |
|---|---|
| Interpreter core (parse + eval + builtins, tree-shaken) | ~33 KB |
| AIR fast path (lower/adder, passes, emit, runtime helpers) | ~10 KB |
| Pyskit shim | ~1 KB |
| **Total** | **~43 KB** |

The budget is informative, not enforced — `build.js` reports the size but doesn't fail the build if it grows. Genuine feature additions may push the bundle higher; that's a legitimate trade.

Packages (natra, plot, sadpan, etc.) are loaded on demand via `load()` — they are NOT part of the base bundle.

### 13.2 Content Security Policy (CSP)

Strict CSP can block pyskit features. Deployments with CSP need these directives:

| Feature | Requires |
|---|---|
| Worker blocks (§5.6) | `worker-src blob:` |
| `load()` from esm.sh / CDN | `script-src` must allow the CDN domain, or `script-src 'self' https:` |
| `load()` via dynamic `import()` | some CSP configurations block dynamic imports — test with your policy |
| HTTP imports (§4.5) | `connect-src` must allow the domains being fetched |
| String imports (§4.6) | same as HTTP imports |
| Inline event attributes | no CSP issue — `adder-click` is NOT an inline JS handler; it's a custom attribute processed by pyskit |

**The base bundle itself has no CSP issues** — it's a regular `<script src="…">` include. CSP friction comes from the dynamic features.

If pyskit features fail silently on a page, CSP is the first thing to check. Pyskit should log a warning to `console.warn` when it detects that a feature was likely blocked (e.g., worker creation throws `SecurityError`).

### 13.3 Progressive enhancement

Before pyskit loads, `<script type="adder">` blocks are invisible — browsers ignore unknown script types. This is correct behavior, not a bug.

If pyskit fails to load entirely (CDN down, network error, blocked by CSP), the page renders normally minus the adder-powered content. No errors, no broken layout — the blocks simply don't execute.

This makes pyskit safe to add to existing pages as an enhancement. Design accordingly — don't make critical page content depend on pyskit unless you control the hosting.

---

## 14. Comparison with PyScript features

| PyScript feature | pyskit equivalent | notes |
|---|---|---|
| `<script type="py">` | `<script type="adder">` | different type, honest about being adder |
| `<py-config>` | `<script type="pyskit-config">` | JSON only, smaller schema — see §12 |
| `<py-repl>` | none (v0.2) | see §15 |
| `<py-terminal>` | `<pyskit-output>` | auto-created, simpler |
| `py-click` etc. | `adder-click` etc. | same pattern |
| `pyscript.web` DOM API | direct `document.*` | no abstraction layer needed |
| `packages = [...]` config | `await load("@natra")` in code | explicit, not declarative |
| `import` from filesystem | `import` via HTTP fetch (§4.5) | `sys.path` entries are URL bases |
| importing by URL | `import "url" as name` (§4.6) | adder language extension, direct fetch |
| Pyodide (numpy, scipy) | natra, plot, sadpan | different libs, same capabilities for common cases |
| npm/JS interop | zero-cost — values ARE JS values | `load("https://esm.sh/d3")` just works |
| MicroPython | adder | both "not full Python" — adder is smaller and faster |
| web workers | `<script type="adder" worker>` | compute off main thread, no DOM |
| offline via service worker | none | serve the bundle however you want |

---

## 15. Future (not in v0.1)

### 15.1 `<adder-repl>` — interactive REPL element

A visible, interactive code input + output widget. User types adder code, presses Enter/Shift+Enter, sees the result. PyScript has `<py-repl>`; this is our version.

Minimal implementation: a `<textarea>` or `<pre contenteditable>` with monospace font, a run button, and an output area. Uses `isIncomplete()` and `evalExpr()` from `@gcu/adder` for last-expression auto-display. No syntax highlighting in v0.2 of the REPL — that's a CM6 dependency we want to avoid in the base bundle.

### 15.2 `<adder-editor>` — visible code block with highlighting

A visible, editable code block that brings in CM6 for syntax highlighting. For interactive tutorials, playgrounds, documentation.

Not in the base bundle. Loaded on demand: `<script type="adder" visible>` or `<adder-editor>` triggers a dynamic import of the editor component.

### 15.3 `adder-src` on non-script elements

`<div adder-src="widget.py">` renders a component into that div. Exploratory.

---

## 16. Test plan

### 16.1 Unit tests (no browser)

- Dedent algorithm — common whitespace stripping
- Error block identification — `src` > `id` > index priority
- Module URL resolution — `@natra` → CDN URL
- Scope builders — expected names present post-`createScope()`
- Config parsing — malformed JSON falls back to defaults; unknown fields ignored
- Config `cdn` rewrites existing aliases pointing at esm.sh
- Config `packages` preload runs in parallel and continues past individual failures
- Boot idempotency — calling `boot()` twice is safe

### 16.2 Integration tests (browser / playwright)

- Basic block execution — `print()` output appears in DOM
- Multiple blocks — second block sees first block's variables
- Block id attribute — `<script type="adder" id="setup">` works, id appears in errors
- Event attributes — click handler fires, modifies DOM
- Async — `await fetch()` in a block works
- Package loading — `load("@natra")` works, result usable in adder code
- External src — `<script type="adder" src="test.py">` loads and executes
- HTTP import — `import utils` fetches `./utils.py` and binds names
- HTTP import package — `from lib.helpers import process` resolves `./lib/helpers.py`
- HTTP import `sys.path` — appending changes search order
- HTTP import caching — second `import utils` uses `sys.modules`, no re-fetch
- HTTP import 404 — missing module raises `ModuleNotFoundError`
- String import — `import "./lib/utils.py" as utils`
- String import from — `from "https://example.com/helpers.py" import fn`
- String import caching — second import of same URL uses `sys.modules`
- Worker block — computes off main thread, results available in next block
- Worker scope transfer — numbers, strings, arrays, objects transfer
- Worker print buffering — output appears in DOM after worker completes
- Worker error — runtime error shows inline, next block still runs
- Worker no DOM — `document` not available in worker scope
- Worker TypedArray — large TypedArrays transferred zero-copy
- Worker sequencing — next block waits for worker
- Output routing — `output="id"` targets correct element
- Error display — syntax error shows `<pyskit-error>` with block identification
- Error block id / src / index — each form appears in message
- Runtime error — `NameError` shows inline, next block still runs
- Dynamic blocks — block added via JS after load executes
- Dynamic events — element with `adder-click` added after load binds
- `pyskit.exec()` — programmatic execution returns value
- `pyskit:ready` — event fires after all blocks execute
- `sys.platform` — reports `'pyskit'` from adder code
- Scope isolation — adder internals not on `window`
- Progressive enhancement — page renders normally without pyskit loaded

### 16.3 Size reporting

`build.js` prints the gzipped size after each build. There's no CI failure threshold — the number is informative, growth over time is expected as features land. Review sizeable jumps in PR review rather than enforcing a hard cap.

---

## 17. What pyskit does NOT do

- **No cell DAG.** That's Auditable's job. Pyskit blocks execute once, in order.
- **No syntax highlighting.** Blocks are hidden `<script>` tags.
- **No CodeMirror.** No editor. Write code in your HTML editor.
- **No notebook features.** No save, no install, no encryption, no signatures.
- **No VFS by default.** Users can call `setAdderVFS` from `@gcu/adder/vfs` themselves.
- **No pypi, no micropip.** GCU ecosystem + npm via `load()`. Not PyPI.
- **Not Python.** It's adder — a Python-flavored dialect. See [@gcu/adder](https://www.npmjs.com/package/@gcu/adder).

---

## 18. Name

a skit is less than a script. pyskit is less than PyScript.

---

*pyskit v0.1 spec — Geoscientific Chaos Union, 2026.*
