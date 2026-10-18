---
name: code-intelligence
description: What code intelligence toil may have (small, pure-JS features such as util size's outlines) and what's ruled out (heavy analysis dependencies: the TypeScript language service or compiler at runtime, tree-sitter WebAssembly grammars, ast-grep, Pyright, IDE bridges), and what reopening that takes. Use when someone proposes code navigation or analysis in toil, asks to add one of those dependencies, or asks why there's no `code` area.
---

# Code Intelligence: small and pure-JS only

The decision is about dependencies, not about code intelligence. toil's job is the
work *around* the code, enterprise tools and databases, and the one thing ruled out
is making every user carry a heavy analysis stack for it.

- **Welcome:** code intelligence built small and in pure JavaScript, inside toil's
  own source, loaded only when its command runs, and honest about its precision
  (*principle 4*). `util size`'s outliner (#184) is the example: a lexer per
  language plus brace or indentation matching gives functions, classes and methods
  with line ranges for six languages, says `precision: "syntactic"`, re-reads each
  symbol's line to check it, and adds about 50 KB to the bundle.
- **Ruled out:** heavy dependencies. The TypeScript language service or compiler as
  a runtime dependency, tree-sitter WebAssembly grammars, ast-grep, Pyright, a
  JetBrains or other IDE bridge, and anything of that weight. Their size and
  maintenance story are below.
- **Reopening** this decision, with a GitHub issue, is needed only to add one of
  those dependencies. A small pure-JS feature needs no reopening; it goes through
  the usual review.

Precise semantic answers (references, call hierarchy, rename, diagnostics) still
belong to language servers, which engineers already get from their IDE or can
install for their agent; nothing pure-JS answers them reliably for Java or C#.

## Why heavy dependencies were ruled out

These are findings from October 2026. Re-check them before reopening this decision.

- **Java and C# only ever get syntax-level answers.** No pure-JS or WASM semantic
  analyzer exists for either language: one needs a JVM, the other .NET. Tree-sitter
  grammars give exact outlines and definitions, but references only by name match.
  A rename built on name matching is not safe, even as a preview. Java and C# are
  the languages enterprise users need most.
- **TypeScript's semantic engine is frozen.** TypeScript 7 is a native binary, which
  breaks **No Executables**. 6.0 is the last JavaScript release and only gets
  security fixes, so semantic TypeScript would be pinned to a line that drifts
  further from real codebases every release.
- **It is heavy.** Today `dist/toil.js` is 1.3 MB on disk, and the npm download is
  0.24 MB. Adding tree-sitter, grammars for TypeScript, JavaScript, Python, Java
  and C#, and ast-grep raises those to about 17 MB and 2.7 MB. Adding the TypeScript
  6 language service and Pyright raises them to about 37 MB and 6.3 MB. Every CLI
  call pays to load that file. The C# grammar alone is 6.8 MB once base64-encoded
  into the bundle.
- **The value is low.** Agents already navigate code well with search and file reads.
  Precise answers come from language servers and IDEs, which are better installed
  separately on machines that allow it.

## If adding a heavy dependency is reopened

The smallest version worth building:

- Outlines, symbol search and definitions from tree-sitter WASM grammars, using each
  grammar's own `tags.scm` queries.
- A ranked repository map, sized to a token budget.
- Structural search by code shape, using a WASM build of ast-grep.

Every result carries a `precision` field (`syntactic` or `semantic`), per
*principle 4*. Any write to the codebase needs the same standing opt-in and explicit
flag as other writes (see **Writes** in CLAUDE.md). Grammars should load lazily
rather than being base64-encoded into the bundle, which needs a reviewed exception
to the single-file rule in **No Executables**.
