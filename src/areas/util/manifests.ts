import { posix } from 'node:path';

/**
 * Finding and parsing dependency manifests and lockfiles: npm, NuGet
 * (including central package management through `Directory.Packages.props`)
 * and Maven/Gradle. Pure functions over a list of paths and a way to read
 * one, so `deps scan` (the working tree) and `deps diff` (a git ref) share
 * every line. The parsing is the long-established behaviour, kept exactly,
 * suspected bugs included (#91 items 8 to 18, each pinned in util.test.ts);
 * a fix waits for a real repository to prove it, as every amendment to a form
 * waits for the form that authorises amendments.
 *
 * Paths are forward-slash and relative to where the scan started, so
 * `node:path`'s posix flavour is used on every platform.
 */

const { basename, dirname, extname } = posix;

export type Ecosystem = 'npm' | 'nuget' | 'maven';

export interface Package {
  name: string;
  version: string;
  ecosystem: Ecosystem;
  source: string;
  type: 'direct' | 'transitive';
  scope: 'production' | 'dev';
}

export interface ManifestInfo {
  file: string;
  ecosystem: Ecosystem;
  framework?: string;
  lockFile?: string;
}

export interface ScanOptions {
  /** `npm`, `nuget`, `maven` or `all`. Anything else matches no ecosystem and scans nothing (#91 item 24). */
  ecosystem?: string;
  includeTransitive?: boolean;
  includeDev?: boolean;
}

export interface ScanData {
  ecosystems: Ecosystem[];
  manifests: ManifestInfo[];
  packages: Package[];
  summary: {
    totalPackages: number;
    byEcosystem: Record<string, number>;
    byType: Record<string, number>;
    byScope: Record<string, number>;
  };
}

/** A file's text, or null when it can't be read; a missing file is not an error. */
export type ReadFile = (relPath: string) => Promise<string | null>;

/** A manifest record, with `lockFile` left out rather than undefined, as JSON would print it. */
function manifest(file: string, ecosystem: Ecosystem, lockFile: string | undefined): ManifestInfo {
  return lockFile === undefined ? { file, ecosystem } : { file, ecosystem, lockFile };
}

// ─── npm ────────────────────────────────────────────────────────────────────

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface PackageLockMeta {
  version?: string;
  dev?: boolean;
  devOptional?: boolean;
}

interface PackageLock {
  lockfileVersion?: number;
  packages?: Record<string, PackageLockMeta>;
}

const NPM_LOCKS = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];

export function findNpmManifests(files: string[]): ManifestInfo[] {
  const lockFiles = new Set(files.filter((f) => NPM_LOCKS.includes(basename(f))));
  const manifests: ManifestInfo[] = [];
  for (const file of files) {
    if (basename(file) !== 'package.json') continue;
    if (file.split('/').includes('node_modules')) continue;
    const dir = dirname(file);
    // The first lockfile found wins, in this order.
    const lockFile = NPM_LOCKS.map((lf) => (dir === '.' ? lf : `${dir}/${lf}`)).find((candidate) => lockFiles.has(candidate));
    manifests.push(manifest(file, 'npm', lockFile));
  }
  return manifests;
}

export function parseNpmPackages(content: string, info: ManifestInfo, opts: ScanOptions, lockContent?: string): Package[] {
  if (lockContent && info.lockFile) {
    const base = basename(info.lockFile);
    if (base === 'package-lock.json') {
      // A lockfile v1, or one with no packages, falls back to package.json; yarn and pnpm don't.
      const pkgs = parsePackageLock(lockContent, info.lockFile, opts);
      if (pkgs.length > 0) return pkgs;
    } else if (base === 'yarn.lock') {
      return parseYarnLock(lockContent, info.lockFile, opts, content);
    } else if (base === 'pnpm-lock.yaml') {
      return parsePnpmLock(lockContent, info.lockFile, opts, content);
    }
  }
  return parsePackageJson(content, info.file, opts);
}

/** `^1.2.0` -> `1.2.0`; non-semver specs (`workspace:*`, `file:`, `npm:`) pass through as they are (#91 item 13). */
function stripVersionPrefix(v: string): string {
  return v.replace(/^[\^~>=<* ]+/, '').split(/\s/)[0] ?? v;
}

function parseJson<T>(content: string): T | undefined {
  try {
    return JSON.parse(content) as T;
  } catch {
    return undefined;
  }
}

function parsePackageJson(content: string, filePath: string, opts: ScanOptions): Package[] {
  const pkg = parseJson<PackageJson>(content);
  if (pkg === undefined) return [];
  const packages: Package[] = [];
  for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
    packages.push({ name, version: stripVersionPrefix(version), ecosystem: 'npm', source: filePath, type: 'direct', scope: 'production' });
  }
  if (opts.includeDev) {
    for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
      packages.push({ name, version: stripVersionPrefix(version), ecosystem: 'npm', source: filePath, type: 'direct', scope: 'dev' });
    }
  }
  return packages;
}

/**
 * package-lock.json v2 and later. Direct means one `node_modules/` segment,
 * so npm's hoisting makes most transitive packages direct (#91 item 8), and a
 * workspace folder (`packages/app`) is kept as a package of that name (item 9).
 */
function parsePackageLock(content: string, lockFilePath: string, opts: ScanOptions): Package[] {
  const lock = parseJson<PackageLock>(content);
  if (lock === undefined) return [];
  if ((lock.lockfileVersion ?? 1) < 2 || !lock.packages) return [];
  const packages: Package[] = [];
  for (const [pkgPath, meta] of Object.entries(lock.packages)) {
    if (pkgPath === '') continue;
    if (!meta.version) continue;
    const isDev = meta.dev === true || meta.devOptional === true;
    if (isDev && !opts.includeDev) continue;
    const withoutRoot = pkgPath.startsWith('node_modules/') ? pkgPath.slice('node_modules/'.length) : pkgPath;
    const segments = withoutRoot.split('/node_modules/');
    const isTransitive = segments.length > 1;
    if (isTransitive && !opts.includeTransitive) continue;
    packages.push({
      name: segments[segments.length - 1] ?? pkgPath,
      version: meta.version,
      ecosystem: 'npm',
      source: lockFilePath,
      type: isTransitive ? 'transitive' : 'direct',
      scope: isDev ? 'dev' : 'production',
    });
  }
  return packages;
}

function directSets(packageJsonContent: string): { direct: Set<string>; dev: Set<string>; all: Set<string> } {
  const pkgJson = parseJson<PackageJson>(packageJsonContent) ?? {};
  const direct = new Set(Object.keys(pkgJson.dependencies ?? {}));
  const dev = new Set(Object.keys(pkgJson.devDependencies ?? {}));
  return { direct, dev, all: new Set([...direct, ...dev]) };
}

/**
 * yarn.lock v1. The name group is greedy, so an unquoted multi-range header
 * (`debug@2.6.9, debug@^2.2.0:`) gives a garbled name (#91 item 10), and a
 * Berry lockfile matches nothing at all, with no fallback (item 11).
 */
function parseYarnLock(content: string, lockFilePath: string, opts: ScanOptions, packageJsonContent: string): Package[] {
  const deps = directSets(packageJsonContent);
  const packages: Package[] = [];
  const seen = new Set<string>();
  const blockRegex = /^"?(@?[^@"\n][^"\n]*)@[^:]+:?\n\s+version "([^"]+)"/gm;
  for (const match of content.matchAll(blockRegex)) {
    const name = match[1]!.trim().replace(/^"|"$/g, '');
    const version = match[2]!;
    const key = `${name}@${version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const isDev = deps.dev.has(name) && !deps.direct.has(name);
    if (isDev && !opts.includeDev) continue;
    const isTransitive = !deps.all.has(name);
    if (isTransitive && !opts.includeTransitive) continue;
    packages.push({ name, version, ecosystem: 'npm', source: lockFilePath, type: isTransitive ? 'transitive' : 'direct', scope: isDev ? 'dev' : 'production' });
  }
  return packages;
}

/**
 * pnpm-lock.yaml v6 keys (`/express@4.21.0:`). Peer suffixes stay in the
 * version, v9's quoted scoped keys don't match, and v9 has no `dev:` flag
 * (#91 item 12).
 */
function parsePnpmLock(content: string, lockFilePath: string, opts: ScanOptions, packageJsonContent: string): Package[] {
  const deps = directSets(packageJsonContent);
  const packages: Package[] = [];
  const seen = new Set<string>();
  const blockRegex = /^\s{2}(\/?@?[^@\s/][^@\s]*)@(\d[^:\s]*):\s*\n((?:\s{4}[^\n]+\n)*)/gm;
  for (const match of content.matchAll(blockRegex)) {
    const name = match[1]!.replace(/^\//, '');
    const version = match[2]!;
    const attrs = match[3] ?? '';
    const key = `${name}@${version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const isDev = (deps.dev.has(name) && !deps.direct.has(name)) || /^\s+dev:\s*true/m.test(attrs);
    if (isDev && !opts.includeDev) continue;
    const isTransitive = !deps.all.has(name);
    if (isTransitive && !opts.includeTransitive) continue;
    packages.push({ name, version, ecosystem: 'npm', source: lockFilePath, type: isTransitive ? 'transitive' : 'direct', scope: isDev ? 'dev' : 'production' });
  }
  return packages;
}

// ─── NuGet ──────────────────────────────────────────────────────────────────

const PROJ_EXTENSIONS = new Set(['.csproj', '.fsproj', '.vbproj']);

export function findNugetManifests(files: string[]): ManifestInfo[] {
  const lockFiles = new Map<string, string>();
  for (const f of files) if (basename(f) === 'packages.lock.json') lockFiles.set(dirname(f), f);
  const manifests: ManifestInfo[] = [];
  for (const file of files) {
    const base = basename(file);
    if (PROJ_EXTENSIONS.has(extname(file)) || base === 'packages.config') manifests.push(manifest(file, 'nuget', lockFiles.get(dirname(file))));
    if (base === 'Directory.Packages.props') manifests.push(manifest(file, 'nuget', lockFiles.get(dirname(file))));
  }
  // Project files that share one packages.lock.json keep one manifest between
  // them, so the lock is parsed once and its packages aren't counted twice.
  const seenLocks = new Set<string>();
  return manifests.filter((m) => {
    if (!m.lockFile) return true;
    if (seenLocks.has(m.lockFile)) return false;
    seenLocks.add(m.lockFile);
    return true;
  });
}

export function parseNugetPackages(content: string, info: ManifestInfo, opts: ScanOptions, lockContent?: string, propsContent?: string): Package[] {
  const base = basename(info.file);
  if (lockContent) return parsePackagesLock(lockContent, info.lockFile ?? info.file, opts);
  if (base === 'packages.config') return parsePackagesConfig(content, info.file);
  if (base === 'Directory.Packages.props') return parseDirectoryPackagesProps(content, info.file);
  return parseCsproj(content, info.file, propsContent);
}

/**
 * `.csproj` / `.fsproj` / `.vbproj`. The multi-line pattern also matches a
 * self-closing element and runs on to the next closing tag, so a multi-line
 * reference after a self-closing one is swallowed (#91 item 14).
 */
function parseCsproj(content: string, filePath: string, propsContent?: string): Package[] {
  const centralVersions = propsContent ? extractCentralVersions(propsContent) : new Map<string, string>();
  const packages: Package[] = [];
  const singleLine = /<PackageReference\s+([^>]+?)\/>/gi;
  const multiLine = /<PackageReference\s+([^>]+?)>([\s\S]*?)<\/PackageReference>/gi;
  const extract = (attrs: string, inner: string): void => {
    const nameMatch = /\bInclude="([^"]+)"/i.exec(attrs);
    if (!nameMatch) return;
    const name = nameMatch[1]!;
    let version: string | undefined;
    const attrVersion = /\bVersion="([^"]+)"/i.exec(attrs);
    if (attrVersion) version = attrVersion[1];
    else if (inner) version = /<Version>([^<]+)<\/Version>/i.exec(inner)?.[1];
    // Central package management, when the version is absent or a property.
    if (!version || version.startsWith('$(')) version = centralVersions.get(name) ?? centralVersions.get(name.toLowerCase());
    if (!version) return;
    packages.push({ name, version, ecosystem: 'nuget', source: filePath, type: 'direct', scope: 'production' });
  };
  for (const m of content.matchAll(singleLine)) extract(m[1]!, '');
  for (const m of content.matchAll(multiLine)) extract(m[1]!, m[2] ?? '');
  return packages;
}

function extractCentralVersions(propsContent: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of propsContent.matchAll(/<PackageVersion\s+Include="([^"]+)"\s+Version="([^"]+)"/gi)) {
    map.set(m[1]!, m[2]!);
    map.set(m[1]!.toLowerCase(), m[2]!);
  }
  return map;
}

function parseDirectoryPackagesProps(content: string, filePath: string): Package[] {
  return [...content.matchAll(/<PackageVersion\s+Include="([^"]+)"\s+Version="([^"]+)"/gi)].map((m) => ({
    name: m[1]!,
    version: m[2]!,
    ecosystem: 'nuget' as const,
    source: filePath,
    type: 'direct' as const,
    scope: 'production' as const,
  }));
}

function parsePackagesConfig(content: string, filePath: string): Package[] {
  return [...content.matchAll(/<package\s+id="([^"]+)"\s+version="([^"]+)"/gi)].map((m) => ({
    name: m[1]!,
    version: m[2]!,
    ecosystem: 'nuget' as const,
    source: filePath,
    type: 'direct' as const,
    scope: 'production' as const,
  }));
}

interface PackagesLockDep {
  resolved?: string;
  type?: string;
}

/** packages.lock.json. Only `Transitive` is transitive, so `CentralTransitive` counts as direct (#91 item 15). */
function parsePackagesLock(content: string, filePath: string, opts: ScanOptions): Package[] {
  const lock = parseJson<{ dependencies?: Record<string, Record<string, PackagesLockDep>> }>(content);
  if (lock === undefined) return [];
  const packages: Package[] = [];
  const seen = new Set<string>();
  for (const frameworkDeps of Object.values(lock.dependencies ?? {})) {
    for (const [name, meta] of Object.entries(frameworkDeps)) {
      const version = meta.resolved ?? '';
      if (!version) continue;
      const isTransitive = meta.type === 'Transitive';
      if (isTransitive && !opts.includeTransitive) continue;
      const key = `${name}@${version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      packages.push({ name, version, ecosystem: 'nuget', source: filePath, type: isTransitive ? 'transitive' : 'direct', scope: 'production' });
    }
  }
  return packages;
}

// ─── Maven / Gradle ─────────────────────────────────────────────────────────

export function findMavenManifests(files: string[]): ManifestInfo[] {
  const lockFiles = new Set(files.filter((f) => basename(f) === 'gradle.lockfile'));
  const manifests: ManifestInfo[] = [];
  for (const file of files) {
    const base = basename(file);
    if (base === 'pom.xml' || base === 'build.gradle' || base === 'build.gradle.kts') {
      const dir = dirname(file);
      const lockCandidate = dir === '.' ? 'gradle.lockfile' : `${dir}/gradle.lockfile`;
      manifests.push(manifest(file, 'maven', lockFiles.has(lockCandidate) ? lockCandidate : undefined));
    }
  }
  return manifests;
}

export function parseMavenPackages(content: string, info: ManifestInfo, opts: ScanOptions, lockContent?: string): Package[] {
  const base = basename(info.file);
  if (lockContent && info.lockFile) return parseGradleLock(lockContent, info.lockFile, opts);
  if (base === 'pom.xml') return parsePomXml(content, info.file, opts);
  if (base === 'build.gradle' || base === 'build.gradle.kts') return parseBuildGradle(content, info.file, opts);
  return [];
}

const tag = (name: string, inner: string) => new RegExp(`<${name}>\\s*([^<\\s]+)\\s*<\\/${name}>`, 'i').exec(inner)?.[1];

/**
 * pom.xml. Only `<dependencyManagement>` is cut out first, so plugin
 * dependencies count as the project's, and a version that names an
 * unresolved property (`${project.version}`) drops the dependency (#91 item 18).
 */
function parsePomXml(content: string, filePath: string, opts: ScanOptions): Package[] {
  const props = extractPomProperties(content);
  const managedVersions = extractDependencyManagement(content, props);
  const withoutMgmt = content.replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/gi, '');
  const packages: Package[] = [];
  for (const match of withoutMgmt.matchAll(/<dependency>([\s\S]*?)<\/dependency>/gi)) {
    const inner = match[1]!;
    const groupId = tag('groupId', inner);
    const artifactId = tag('artifactId', inner);
    if (!groupId || !artifactId) continue;
    const resolvedVersion = resolveProperty(tag('version', inner) ?? null, props) ?? managedVersions.get(`${groupId}:${artifactId}`);
    if (!resolvedVersion) continue;
    const scope = tag('scope', inner) ?? 'compile';
    const isDev = scope === 'test' || scope === 'provided';
    if (isDev && !opts.includeDev) continue;
    packages.push({ name: `${groupId}:${artifactId}`, version: resolvedVersion, ecosystem: 'maven', source: filePath, type: 'direct', scope: isDev ? 'dev' : 'production' });
  }
  return packages;
}

function extractPomProperties(content: string): Map<string, string> {
  const props = new Map<string, string>();
  const propsMatch = /<properties>([\s\S]*?)<\/properties>/i.exec(content);
  if (!propsMatch) return props;
  for (const m of propsMatch[1]!.matchAll(/<([a-zA-Z0-9._-]+)>\s*([^<]+)\s*<\/\1>/g)) props.set(m[1]!, m[2]!.trim());
  return props;
}

function extractDependencyManagement(content: string, props: Map<string, string>): Map<string, string> {
  const versions = new Map<string, string>();
  const mgmtMatch = /<dependencyManagement>([\s\S]*?)<\/dependencyManagement>/i.exec(content);
  if (!mgmtMatch) return versions;
  for (const m of mgmtMatch[1]!.matchAll(/<dependency>([\s\S]*?)<\/dependency>/gi)) {
    const inner = m[1]!;
    const groupId = tag('groupId', inner);
    const artifactId = tag('artifactId', inner);
    const rawVersion = tag('version', inner);
    if (!groupId || !artifactId || !rawVersion) continue;
    const resolved = resolveProperty(rawVersion, props);
    if (resolved) versions.set(`${groupId}:${artifactId}`, resolved);
  }
  return versions;
}

/** `${name}` replaced from the pom's properties; null when any placeholder is left, so the managed version is tried. */
function resolveProperty(value: string | null, props: Map<string, string>): string | null {
  if (!value) return null;
  const resolved = value.replace(/\$\{([^}]+)\}/g, (_, key: string) => props.get(key) ?? `\${${key}}`);
  return /\$\{[^}]+\}/.test(resolved) ? null : resolved;
}

const GRADLE_DEV_CONFIGS = new Set(['testImplementation', 'testCompileOnly', 'testRuntimeOnly', 'testApi']);

/**
 * build.gradle / build.gradle.kts. Any `word 'a:b:c'` is read as a
 * dependency, a repository URL with a port included, and a classifier stays
 * in the version (#91 item 17).
 */
function parseBuildGradle(content: string, filePath: string, opts: ScanOptions): Package[] {
  const packages: Package[] = [];
  const seen = new Set<string>();
  const add = (config: string, groupId: string, artifactId: string, version: string) => {
    const isDev = GRADLE_DEV_CONFIGS.has(config);
    if (isDev && !opts.includeDev) return;
    const name = `${groupId}:${artifactId}`;
    const key = `${name}@${version}`;
    if (seen.has(key)) return;
    seen.add(key);
    packages.push({ name, version, ecosystem: 'maven', source: filePath, type: 'direct', scope: isDev ? 'dev' : 'production' });
  };
  // Groovy `implementation 'g:a:v'`, Kotlin `implementation("g:a:v")`; `@ext` is cut off.
  for (const m of content.matchAll(/\b(\w+)\s*\(?\s*['"]([^:'"]+):([^:'"]+):([^'"]+)['"]\s*\)?/g)) add(m[1]!, m[2]!, m[3]!, m[4]!.split('@')[0]!);
  // Map notation: `implementation group: 'g', name: 'a', version: 'v'`.
  for (const m of content.matchAll(/\b(\w+)\s+group:\s*['"]([^'"]+)['"]\s*,\s*name:\s*['"]([^'"]+)['"]\s*,\s*version:\s*['"]([^'"]+)['"]/g)) add(m[1]!, m[2]!, m[3]!, m[4]!);
  return packages;
}

/**
 * gradle.lockfile. Lockfiles name resolvable configurations
 * (`testRuntimeClasspath`), never the declaring ones checked here, so test
 * dependencies are always kept, and every line is `direct` (#91 item 16).
 */
function parseGradleLock(content: string, filePath: string, opts: ScanOptions): Package[] {
  const packages: Package[] = [];
  const seen = new Set<string>();
  for (const m of content.matchAll(/^([^:#\s]+):([^:#\s]+):([^=\s]+)=(.+)$/gm)) {
    const configs = m[4]!.split(',').map((s) => s.trim());
    const isDev = configs.every((c) => GRADLE_DEV_CONFIGS.has(c));
    if (isDev && !opts.includeDev) continue;
    const name = `${m[1]!}:${m[2]!}`;
    const version = m[3]!;
    const key = `${name}@${version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    packages.push({ name, version, ecosystem: 'maven', source: filePath, type: 'direct', scope: isDev ? 'dev' : 'production' });
  }
  return packages;
}

// ─── The scan ───────────────────────────────────────────────────────────────

/** The nearest Directory.Packages.props, from the manifest's folder up to the scan's top, at most 10 levels. */
async function findPropsContent(manifestFile: string, read: ReadFile): Promise<string | null> {
  let dir = dirname(manifestFile);
  for (let depth = 0; depth < 10; depth++) {
    const content = await read(dir === '.' ? 'Directory.Packages.props' : `${dir}/Directory.Packages.props`);
    if (content) return content;
    if (dir === '.') break;
    dir = dirname(dir);
  }
  return null;
}

/**
 * Every package in the manifests, de-duplicated on ecosystem, name, version
 * and source. An empty or unreadable manifest is skipped; a lockfile wins
 * over its manifest.
 */
async function parseManifests(manifests: ManifestInfo[], opts: ScanOptions, read: ReadFile): Promise<Package[]> {
  const all: Package[] = [];
  const seen = new Set<string>();
  for (const info of manifests) {
    const content = await read(info.file);
    if (!content) continue;
    const lockContent = info.lockFile ? ((await read(info.lockFile)) ?? undefined) : undefined;
    let pkgs: Package[];
    if (info.ecosystem === 'npm') pkgs = parseNpmPackages(content, info, opts, lockContent);
    else if (info.ecosystem === 'nuget') pkgs = parseNugetPackages(content, info, opts, lockContent, (await findPropsContent(info.file, read)) ?? undefined);
    else pkgs = parseMavenPackages(content, info, opts, lockContent);
    for (const pkg of pkgs) {
      const key = `${pkg.ecosystem}:${pkg.name}@${pkg.version}:${pkg.source}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(pkg);
    }
  }
  return all;
}

/** The inventory of `files` (forward-slash paths relative to the scan's top), read through `read`. */
export async function scanFiles(files: string[], opts: ScanOptions, read: ReadFile): Promise<ScanData> {
  const eco = opts.ecosystem ?? 'all';
  const manifests = [
    ...(eco === 'all' || eco === 'npm' ? findNpmManifests(files) : []),
    ...(eco === 'all' || eco === 'nuget' ? findNugetManifests(files) : []),
    ...(eco === 'all' || eco === 'maven' ? findMavenManifests(files) : []),
  ];
  return buildScanData(manifests, await parseManifests(manifests, opts, read));
}

export function buildScanData(manifests: ManifestInfo[], packages: Package[]): ScanData {
  const byEcosystem: Record<string, number> = {};
  const byType: Record<string, number> = { direct: 0, transitive: 0 };
  const byScope: Record<string, number> = { production: 0, dev: 0 };
  for (const pkg of packages) {
    byEcosystem[pkg.ecosystem] = (byEcosystem[pkg.ecosystem] ?? 0) + 1;
    byType[pkg.type] = (byType[pkg.type] ?? 0) + 1;
    byScope[pkg.scope] = (byScope[pkg.scope] ?? 0) + 1;
  }
  return {
    ecosystems: Array.from(new Set(manifests.map((m) => m.ecosystem))),
    manifests,
    packages,
    summary: { totalPackages: packages.length, byEcosystem, byType, byScope },
  };
}
