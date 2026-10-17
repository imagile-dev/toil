// Reads the predecessor's TypeScript source and records, for each command, the
// field names of the `data` it returns. The --help walk in
// capture-command-contract.mjs can see flags but not output, and a renamed
// output field breaks a caller's script just as surely as a renamed flag.
//
// It finds every `success(data, ...)` call, works out which command's
// `.action()` it sits in by following the Commander chain back to the program
// (through variables, and through register functions' parameters to their call
// sites), and asks the TypeScript checker for the type of `data`. Paths are
// recorded two levels deep, arrays are looked through (`issues[].key`), and an
// optional property ends in `?`. A command whose data is `any` or `unknown`
// is recorded as opaque, which is the checker's way of saying the form was
// returned with the box left blank.
//
// Used by capture-command-contract.mjs (--source <repo>); not run on its own.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const DEPTH = 2;

/**
 * @param {string} repo the predecessor's checkout: tsconfig.json, src/ and node_modules/
 * @returns {Map<string, Array<{ fields: string[] } | { opaque: string }>>} command path to its output variants
 */
export function captureOutput(source) {
  // The checker reports absolute file names, so a relative --source has to be made absolute to match them.
  const repo = resolve(source);
  const configPath = join(repo, 'tsconfig.json');
  const parsed = ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, (p) => readFileSync(p, 'utf8')).config, ts.sys, dirname(configPath));
  const program = ts.createProgram({ rootNames: parsed.fileNames.filter((f) => !/\.test\.ts$/.test(f)), options: parsed.options });
  const checker = program.getTypeChecker();
  const files = program.getSourceFiles().filter((f) => !f.isDeclarationFile && f.fileName.startsWith(join(repo, 'src').replace(/\\/g, '/')));

  /** Every call expression in the program, for finding a function's call sites. */
  const calls = [];
  const successCalls = [];
  for (const file of files) {
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        calls.push(node);
        if (ts.isIdentifier(node.expression) && node.expression.text === 'success' && node.arguments.length >= 3) successCalls.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }

  const declOf = (id) => {
    let symbol = checker.getSymbolAtLocation(id);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    return symbol?.declarations?.[0];
  };

  const functionName = (fn) => {
    if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) && fn.name) return fn.name;
    if ((ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && ts.isVariableDeclaration(fn.parent)) return fn.parent.name;
    return undefined;
  };

  /** Calls whose callee resolves to `fn`. */
  const callsTo = (fn) => {
    const name = functionName(fn);
    if (!name || !ts.isIdentifier(name)) return [];
    return calls.filter((c) => {
      const callee = ts.isIdentifier(c.expression) ? c.expression : undefined;
      if (!callee || callee.text !== name.text) return false;
      const decl = declOf(callee);
      return decl === fn || decl === fn.parent;
    });
  };

  /** The strings an expression can be: a literal, or a parameter's argument at each call site (`voteCmd('approve', ...)`). */
  const stringsOf = (expr) => {
    if (ts.isStringLiteralLike(expr)) return [expr.text];
    const decl = ts.isIdentifier(expr) ? declOf(expr) : undefined;
    if (!decl || !ts.isParameter(decl)) return [];
    const fn = decl.parent;
    const index = fn.parameters.indexOf(decl);
    return callsTo(fn).flatMap((c) => (c.arguments[index] ? stringsOf(c.arguments[index]) : []));
  };

  /** The command paths a Commander expression stands for: [] is the program itself. */
  const pathsOf = (expr, seen = new Set()) => {
    if (seen.has(expr)) return [];
    seen.add(expr);
    while (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isNonNullExpression(expr)) expr = expr.expression;
    if (ts.isNewExpression(expr)) return [[]];
    if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression)) {
      const parents = pathsOf(expr.expression.expression, seen);
      const method = expr.expression.name.text;
      const first = expr.arguments[0];
      if (method === 'command' && first) return stringsOf(first).flatMap((name) => parents.map((p) => [...p, name.split(/\s/)[0]]));
      return parents;
    }
    if (ts.isIdentifier(expr)) {
      const decl = declOf(expr);
      if (!decl) return [];
      if (ts.isVariableDeclaration(decl) && decl.initializer) return pathsOf(decl.initializer, seen);
      if (ts.isParameter(decl)) {
        const fn = decl.parent;
        const index = fn.parameters.indexOf(decl);
        return callsTo(fn).flatMap((c) => (c.arguments[index] ? pathsOf(c.arguments[index], seen) : []));
      }
    }
    return [];
  };

  /** The commands whose `.action()` reaches this node, directly or through helper functions. */
  const commandsFor = (node, seen = new Set()) => {
    for (let at = node.parent; at; at = at.parent) {
      if (ts.isCallExpression(at) && ts.isPropertyAccessExpression(at.expression) && at.expression.name.text === 'action' && at.arguments.some((a) => a.pos <= node.pos && node.end <= a.end)) {
        return pathsOf(at.expression.expression);
      }
      if (ts.isFunctionLike(at) && functionName(at) && !seen.has(at)) {
        seen.add(at);
        const viaCallers = callsTo(at).flatMap((c) => commandsFor(c, seen));
        if (viaCallers.length) return viaCallers;
      }
    }
    return [];
  };

  const describe = (type, node, depth, prefix, out) => {
    if (depth > DEPTH) return true;
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return depth > 1 || prefix !== '';
    if (type.isUnion()) {
      const members = type.types.filter((t) => !(t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)));
      const objects = members.filter((t) => t.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection));
      if (objects.length === 0) return true;
      // A property is required only when every member has it as required.
      const perMember = objects.map((t) => {
        const fields = [];
        describe(t, node, depth, prefix, fields);
        return fields;
      });
      const all = new Set(perMember.flat().map((f) => f.replace(/\?$/, '')));
      for (const field of all) {
        const required = perMember.every((fields) => fields.includes(field));
        out.push(required ? field : `${field}?`);
      }
      return true;
    }
    if (checker.isArrayType(type) || checker.isTupleType(type)) {
      const element = checker.getTypeArguments(type)[0];
      if (element) return describe(element, node, depth, `${prefix}[]`, out);
      return true;
    }
    if (!(type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection))) return true;
    const props = checker.getPropertiesOfType(type);
    if (props.length === 0) return depth > 1 || prefix !== '';
    for (const prop of props) {
      const propType = checker.getTypeOfSymbolAtLocation(prop, node);
      if (propType.getCallSignatures().length > 0) continue;
      const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
      const path = prefix ? `${prefix}.${prop.name}` : prop.name;
      out.push(optional ? `${path}?` : path);
      if (depth < DEPTH) {
        // Children of an optional or nullable parent are optional too: they
        // can't be required where the parent may be absent or null.
        const nullable = propType.isUnion() && propType.types.some((t) => t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined));
        const children = [];
        describe(propType, node, depth + 1, path, children);
        for (const child of children) out.push((optional || nullable) && !child.endsWith('?') ? `${child}?` : child);
      }
    }
    return true;
  };

  const out = new Map();
  for (const call of successCalls) {
    const data = call.arguments[0];
    const service = call.arguments[1];
    const action = call.arguments[2];
    let paths = commandsFor(call).map((p) => p.join(' ')).filter(Boolean);
    if (paths.length === 0 && ts.isStringLiteralLike(service) && ts.isStringLiteralLike(action)) paths = [`${service.text} ${action.text}`];
    const type = checker.getTypeAtLocation(data);
    const fields = [];
    const known = describe(type, data, 1, '', fields);
    const variant = known ? { fields: [...new Set(fields)].sort() } : { opaque: checker.typeToString(type).slice(0, 80) };
    for (const path of new Set(paths)) {
      const list = out.get(path) ?? [];
      if (!list.some((v) => JSON.stringify(v) === JSON.stringify(variant))) list.push(variant);
      out.set(path, list);
    }
  }
  if (out.size === 0) throw new Error(`No success(...) calls found under ${join(repo, 'src')}; is --source the predecessor's checkout?`);
  return out;
}
