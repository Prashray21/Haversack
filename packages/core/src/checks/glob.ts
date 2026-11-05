import picomatch from "picomatch";

/** Glob matching operates on forward-slash repo-relative paths only (Windows callers normalize first). */
export function toPosixPath(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Compiles glob patterns into a path predicate. `dot: true` so patterns like
 * `.github/**` and `**` match dot-directories — AI-tool configs live there.
 * Patterns are repo-root-relative.
 */
export function compileGlobs(patterns: readonly string[]): (path: string) => boolean {
  if (patterns.length === 0) return () => false;
  const matcher = picomatch([...patterns], { dot: true });
  return (candidate: string) => matcher(toPosixPath(candidate));
}

/**
 * Include/exclude resolution: a path matches only when it matches at least one
 * include pattern AND no exclude pattern — exclude always wins over include.
 */
export function matchesPath(
  candidate: string,
  includes: readonly string[],
  excludes: readonly string[],
): boolean {
  return compileGlobs(includes)(candidate) && !compileGlobs(excludes)(candidate);
}
