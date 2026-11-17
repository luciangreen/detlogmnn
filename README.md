# Detlog MNN

A Prolog converter and interpreter that runs each query on the faster of two exact routes, and on
Prolog for anything neither can keep exact. It runs from a web page with no server, on a phone or a
computer, and keeps its files on the device. There are apps for iPhone and iPad, Android, and Mac,
Windows and Linux that load the same page.

**Open it:** download [`dist/index.html`](dist/index.html) and open it in a browser, or use the
GitHub Pages site once Pages is turned on (Settings › Pages › Source: GitHub Actions). The apps are
built by the **Apps** workflow: open a run and download them from its Artifacts.

## How a query runs

| Route | What it is | When it is used |
|---|---|---|
| **C** | pl2detlog's native tier: the analysis of its Prolog → Detlog → C export, compiled to JavaScript (a web page can't compile C). Raw integers, no unification, no choice points. | Calls that meet the type contract: ground inputs and fresh outputs. Any other call, and any value it can't follow (a non-integer, a result beyond 2^53), bails out to the MNN route. |
| **MNN** | The proved Detlog MNN rewrite, run by pl2detlog's JIT. Full terms and unification, no choice points. | Everything the conversion keeps exact. |
| **Prolog** | pl2detlog's reference Prolog engine. | Conversion errors, queries that reach `assert`/`retract`, anything the round trip back to Prolog reports as missing, and every error, so errors are always Prolog's own. Also queries with endless answers (`len(L, 1)`): the converted routes work out every answer first and reach their limit, while Prolog gives the answers it finds. |

The first run of a query times the C and MNN routes and plain Prolog, checks that their answers
agree (if the C and MNN routes don't, Prolog decides), and keeps the fastest for later runs. So where
the determinism rewrites make a query slower, plain Prolog runs it.

**No runtime checks by default.** The C route assumes its type contract and tests nothing as it runs
(no type, overflow or zero-divisor tests). A query outside the contract, such as one whose results go
past 2^53, is caught on its first run, when the C and MNN routes disagree, and Prolog decides. Turn on
**Runtime checks** to have the C route test the contract itself and bail out to the MNN route. **Check against Prolog** also runs Prolog
and compares, and **Prove** shows pl2detlog's proof checks and round trip for the recent queries.

### Exactness

This follows the checklist from the "Detlog C vs MNN" chat: *the proof makes the Detlog rewrite exact;
the type contract plus point 1 make the C version exact; the tests and round trip check that the
generated code matches both.*

1. **A bound output (point 1).** `label([2,3], even(3))` fails in Prolog, because `->` commits to 2. A query with an
   output already given is run as `label([2,3], R), R = even(3)`: compute, then unify, never
   search for a value that matches. This is used only where `web/lib/hybrid.js` proves the argument
   steadfast from the clauses (the output untouched until the last commit, then only bound). The
   cut-in-head `max(X, Y, X) :- X >= Y, !.` is not steadfast (`max(5, 3, 3)` is true in Prolog), so it runs
   as written.
2. **Order and commitment.** The Detlog rewrite keeps Prolog's left-to-right order and `->`'s commitment, and
   pl2detlog proves it per predicate.
3. **Arithmetic.** Integers are unbounded, as in SWI-Prolog: `fact(30, F)` gives
   `265252859812191058636308480000000` on every route. `mod` takes the divisor's sign. The C route
   bails out before any result leaves the safe integers.
4. **Errors and odd inputs.** Type errors, instantiation errors and partial lists raise the same errors as Prolog,
   because Prolog runs any query that ends in an error.
5. **Translation validation.** The tests and the 200 inputs and outputs run every query on the
   hybrid and on Prolog and check that they agree. They include the checklist's cases: negative numbers, big integers, floats,
   empty lists, bound outputs, partial lists and type errors.

### time/1

`time(Goal)` in a query runs `Goal` on the hybrid and reports as SWI-Prolog does, with the route
used: `% 33 inferences, 0.000 CPU in 0.000 seconds (100% CPU, 330,000 Lips) [C]`. In a program
running on the Prolog route it is a builtin that writes the same line.

### Prolog compatibility

The program runs on pl2detlog's Prolog engine and builtins (ISO core plus the common SWI
library predicates: lists, `findall`/`bagof`/`setof`, `format`, strings, `between`, `msort`, DCGs,
`assert`/`retract`, `catch`/`throw` and more). `:- consult(file).`, `:- [a, b].` and
`:- include(file).` load other files from the app's files.

## Files on the device

| Where it runs | Where the files are |
|---|---|
| iPhone / iPad app | The app's Documents folder: Files app › On My iPhone › Detlog MNN |
| Android app | The app's folder on the phone (Android/data/com.luciangreen.detlogmnn/files). Export uses the share sheet. |
| Desktop app | Documents/Detlog MNN, or another folder chosen with File › Choose Files Folder… |
| Chrome or Edge on a computer | A folder you choose with **Use a folder on this computer** (it's remembered) |
| Safari, Chrome on a phone, Firefox | The browser's private storage on the device, with **Import…** and **Export** to move files in and out |

All of these use one interface (`web/lib/files.js`), and the apps answer the same requests
(`shells/*`).

## Sizes

The page has a phone layout below 900 px wide, with Program, Run, Plan and Files tabs. At desktop
width (Mac, Windows and Linux windows) it shows files, program, run and plan side by side.

## The apps (`shells/`)

- `shells/ios`: a Swift app with a full-screen `WKWebView` loading the bundled site, as an XcodeGen spec.
  The workflow builds it for the simulator and as an unsigned device build. To install it on a
  phone, open it in Xcode (`brew install xcodegen && cd shells/ios && xcodegen generate`) and sign
  it with your Apple ID.
- `shells/android`: a Kotlin app with a full-screen `WebView`, serving the site from the app's assets. The
  workflow builds a debug APK, which you can install on the phone (allow installing from this source).
- `shells/electron`: the desktop app. The workflow builds `.dmg`/`.zip` (Mac), `.exe` (Windows) and
  `.AppImage`/`.deb` (Linux). The builds aren't signed, so on a Mac open it the first time with
  Control-click › Open.

Locally: `node scripts/build.mjs`, then `cd shells/electron && npm install && npm start`.

## Development

- `web/`: the page (`index.html`, `app.css`, `app.js`), `lib/hybrid.js` (routes, point 1, `time/1`,
  consult), `lib/files.js` (files on the device) and `lib/pl2detlog.js`, which is
  [pl2detlog](https://github.com/luciangreen/pl2detlog)'s library. Update it with
  `sh scripts/vendor-pl2detlog.sh ../pl2detlog`.
- `node scripts/build.mjs` writes `dist/`: one self-contained `index.html` that works from `file://`, plus
  icons, the manifest and the offline service worker. There are no dependencies.
- `npm test` runs the hybrid, files, build and desktop file-bridge tests, and the 200 inputs and outputs.
- `io/ios.txt` has 200 inputs and outputs from real runs (`io/cases.mjs`): queries on the hybrid
  with the checklist's edge cases, steadfastness, point 1, consult, `time/1` lines and file
  operations. `npm run ios` writes them, and the tests check that they don't change.

BSD-3-Clause.
