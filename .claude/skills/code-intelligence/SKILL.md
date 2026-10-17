---
name: code-intelligence
description: Rules for toil's `code` area, which answers questions about a codebase without executables (symbol search, symbol info, definitions, references, call hierarchy, diagnostics, rename preview). Use when adding or changing a `code` command, the TypeScript language service integration, tree-sitter WebAssembly grammars, the optional JetBrains IDE bridge, or the `precision` field on code results.
---

# Code Intelligence

`code` commands answer questions about a codebase (symbol search, symbol info,
definitions, references, call hierarchy, diagnostics, rename preview) without
executables. Each result says how precise it is:

- `semantic` — TypeScript and JavaScript, via the TypeScript compiler's language
  service, which is pure JS. The MCP server keeps one warm per project.
- `syntactic` — every other language (C#, Java, Python, Go, SQL, …), via tree-sitter
  grammars compiled to WebAssembly (`web-tree-sitter`). Definitions and outlines are
  exact; references are name-matched and say so.
- `ide` — when the user has a JetBrains IDE open with its MCP server enabled, `code`
  can query it over localhost HTTP for semantic answers in any language the IDE
  understands. Opt-in per project, never required, and off when the IDE isn't running.

Results carry file, line and column. Rename previews by default and applies with
`--apply`. Building and testing are left to the project's own toolchain; toil does not
wrap them.
