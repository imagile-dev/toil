---
name: code-intelligence
description: Why toil has no `code` area (symbol search, definitions, references, call hierarchy, diagnostics, rename), and what it would take to reopen that. Use when someone proposes code navigation or analysis in toil, asks to add the TypeScript language service, tree-sitter WebAssembly grammars, ast-grep, Pyright or a JetBrains IDE bridge as a dependency, or asks why the `code` area went away.
---

# Code Intelligence (deferred)

toil does not answer questions about a codebase. There is no `code` area, and none
is planned. Symbol search, definitions, references, call hierarchy, diagnostics and
rename belong to language servers, which engineers already get from their IDE or
can install for their agent. toil's job is the work *around* the code: enterprise
tools and databases.

Don't add a code-navigation command, and don't add a language-analysis library as a
dependency, until this decision is reopened with a GitHub issue.

## Why it was deferred

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

## If it is reopened

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
