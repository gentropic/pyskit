# pyskit

`<script type="adder">` for vanilla HTML pages. A thin DOM shim over [@gcu/adder](https://www.npmjs.com/package/@gcu/adder) — Python-flavored scripting with no build step, no WASM, and instant cold start.

**~35 KB total, gzipped.** No cold-start penalty. No WASM. No CPython.

Pre-1.0 — API may break on minor version bumps.

## Hello, world

```html
<!DOCTYPE html>
<html>
<head>
<script src="https://unpkg.com/@gcu/pyskit/dist/pyskit.bundle.min.js"></script>
</head>
<body>

<script type="adder">
  print("hello, pyskit")
</script>

</body>
</html>
```

That's it. Drop the `<script>` include into any HTML page, then write `<script type="adder">` blocks. They execute in document order with a shared scope; `print()` renders next to each block.

## What you get

- **Python-flavored syntax** — functions, classes, decorators, comprehensions, async/await, import, try/except, f-strings, and so on. Full list at [@gcu/adder's SPEC](https://www.npmjs.com/package/@gcu/adder).
- **Direct DOM access** — `document.createElement`, `window.fetch`, `setTimeout`, etc. are in scope. No pyscript.web proxy layer.
- **No FFI boundary** — adder values ARE JS values. A list in adder is a JS `Array`; a dict is a JS `Object`. Every npm package is a native library.
- **Event attributes** — `adder-click`, `adder-input`, `adder-keydown`, etc. The attribute value is adder code; it runs when the event fires.
- **Targeted output** — route `print()` anywhere via `<script type="adder" output="my-div">`.
- **Inline errors** — a runtime error on one block shows the traceback near that block; subsequent blocks keep executing.
- **Dynamic blocks** — `<script type="adder">` added after page load auto-executes via `MutationObserver`.

## What pyskit is not

- Not Python. It's [adder](https://www.npmjs.com/package/@gcu/adder) — a Python-flavored dialect with 90%+ Python semantics but not every module in CPython's stdlib.
- Not PyScript. PyScript ships Pyodide (CPython + numpy + pandas) or MicroPython. Pyskit targets the MicroPython niche (lightweight browser Python) with a different cost profile — pure JS, no WASM, no cold start, and direct DOM access.
- Not a framework. No components, no virtual DOM, no reactivity.

If you need real CPython packages (`import sklearn`, `import sympy`), use [PyScript](https://pyscript.net/) with Pyodide instead. Different weight class.

## Package loading

```html
<script type="adder">
natra = await load("@natra")
x = natra.linspace(0, 10, 100)
y = natra.sin(x)

plot = await load("@plot")
fig = plot.figure(400, 300)
fig.plot(x, y)
display(fig.el)
</script>
```

`load()` resolves known `@`-prefix names to their GCU CDN URLs; full URLs pass through unchanged, so `load("https://esm.sh/d3")` works too.

**Available packages** (a few of the GCU ecosystem):

| package | provides | Python-ish equivalent |
|---|---|---|
| `@natra` | ndarray, broadcasting, linear algebra | numpy |
| `@plot` | 2D plotting on canvas | matplotlib |
| `@sadpan` | dataframe ops, TypedArray columns | pandas |
| `@gcu/gslib` | geostatistics (kriging, simulation) | — |
| `@gcu/bearing` | structural geology, stereonets | mplstereonet |
| `@gcu/spinifex` | browser GIS | — |

## Interactive example

```html
<button adder-click="on_click()">increment</button>
<span id="count">0</span>

<script type="adder">
  n = 0
  def on_click():
      global n
      n = n + 1
      document.getElementById("count").textContent = str(n)
</script>
```

Event attributes take adder code as their value. On click, the code runs in the shared page scope — so `on_click` from the earlier block is visible.

## Running it locally

```sh
git clone https://github.com/gentropic/pyskit
cd pyskit
npm install
npm run build        # produces dist/pyskit.bundle.min.js
```

Then open `example/index.html` in a browser (via a local dev server — `file://` blocks many of the dynamic features).

## JS API

```js
// after 'pyskit:ready' fires
window.pyskit.version                 // '0.1.0'
await window.pyskit.exec('x = 42')    // execute adder code
window.pyskit.scope.get('x')          // 42
await window.pyskit.load('@natra')    // programmatic load()
```

## License

MIT — see [LICENSE](./LICENSE). Specification in [SPEC.md](./SPEC.md).

Pyskit is built by the [Geoscientific Chaos Union](https://gentropic.org) and is part of the ecosystem around [Auditable](https://github.com/endarthur/auditable).
