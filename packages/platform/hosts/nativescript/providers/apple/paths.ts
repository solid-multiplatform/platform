/**
 * Resolves `path` inside `root` and returns the absolute result. Throws when
 * the path would leave the root: an absolute path elsewhere, or `..` segments
 * that climb out. For the file-system provider's Documents, Caches and tmp
 * directories.
 */
export function confine(root: string, path: string): string {
  const base = root.replace(/\/+$/, '');
  const inside = path.startsWith('/')
    ? path === base || path.startsWith(base + '/')
      ? path.slice(base.length)
      : undefined
    : path;
  if (inside === undefined) throw new Error('Path outside ' + base);
  const parts: string[] = [];
  for (const part of inside.split('/')) {
    if (part === '' || part === '.') continue;
    if (part !== '..') parts.push(part);
    else if (parts.pop() === undefined) throw new Error('Path outside ' + base);
  }
  return [base, ...parts].join('/');
}
