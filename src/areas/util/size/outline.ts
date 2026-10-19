import { CODE_METHOD, outlineCode, type CodeSymbol } from './code.js';
import { keySymbols, outlineMarkdown, scanJsonKeys, scanYamlKeys, type DataSymbol } from './data.js';
import { OutlineError, type CodeLanguage } from './lexer.js';

/**
 * One file's outline for `util size`, made in the bounded worker
 * (kit/bounded.ts), never on the command's own thread: the lexer and the
 * outliners recurse and scan as the file asks them to, and a file of nested
 * template literals ran the stack out while a file of headings took minutes
 * (#200). The worker sends back plain data: the outline, the keys the parser
 * found (for the command's own check against the scan), or why there's no
 * outline. A file's structure is reviewed in a separate room, by appointment.
 */

export type OutlineLanguage = CodeLanguage | 'markdown' | 'json' | 'yaml';

export interface Outlined {
  outline: { precision: 'syntactic' | 'parsed'; method: string; symbols: Array<CodeSymbol | DataSymbol> };
  /** For JSON and YAML: the top-level keys the parser returned, sorted and unique, to hold the scanned keys against. */
  parsedKeys?: string[];
}

/** Why there's no outline: the file didn't parse, said with a line and column, never its text. */
export interface NotParsed {
  parseError: string;
}

/** JSON.parse's complaint as a line and column, never the text it quotes. */
function jsonError(err: Error, text: string): string {
  const at = /position (\d+)/.exec(err.message);
  if (!at) return "it isn't valid JSON";
  const before = text.slice(0, Number(at[1]));
  // Counted as measure.ts's lineCount counts: a trailing newline ends a line rather than starting one.
  const breaks = before.split('\n').length - 1;
  const line = Math.max(1, before.endsWith('\n') ? breaks : breaks + 1);
  const column = before.length - before.lastIndexOf('\n');
  return `it isn't valid JSON at line ${line}, column ${column}`;
}

/**
 * The outline of `text` as `language`. `parseYaml` is kit/yaml.ts's, handed
 * in by the worker so this module needs no lazy import of its own. An
 * unreadable file is `{ parseError }`; anything else that goes wrong (the
 * stack running out) is thrown for the worker to report.
 */
export function outlineText(language: OutlineLanguage, text: string, parseYaml: (text: string, label: string) => unknown): Outlined | NotParsed {
  try {
    if (language === 'markdown') {
      return { outline: { precision: 'syntactic', method: 'ATX (#) and setext (underlined) headings, outside fenced code blocks and front matter. Each runs to the line before the next heading of the same or a higher level', symbols: outlineMarkdown(text) } };
    }
    if (language === 'json' || language === 'yaml') {
      let parsed: unknown;
      if (language === 'json') {
        try {
          parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
        } catch (err) {
          return { parseError: jsonError(err as Error, text) };
        }
      } else parsed = parseYaml(text, 'it');
      const keys = language === 'json' ? scanJsonKeys(text) : scanYamlKeys(text);
      const isMapping = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
      return {
        outline: {
          precision: 'parsed',
          method: `Top-level keys, found by scanning the text and held against the keys ${language === 'json' ? 'JSON.parse' : 'the YAML parser'} returns. A document whose top level isn't a mapping has none`,
          symbols: keySymbols(keys),
        },
        parsedKeys: isMapping ? [...new Set(Object.keys(parsed as object))].sort() : [],
      };
    }
    return { outline: { precision: 'syntactic', method: CODE_METHOD[language], symbols: outlineCode(text, language) } };
  } catch (err) {
    // An unreadable file (OutlineError), or YAML that doesn't parse (kit/yaml's ToilError): no outline, and why.
    if (err instanceof OutlineError || (err instanceof Error && err.name === 'ToilError')) return { parseError: err.message };
    throw err;
  }
}
