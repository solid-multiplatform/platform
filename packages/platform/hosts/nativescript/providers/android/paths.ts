/**
 * Keeps file paths inside the app's own directories. No platform calls: the
 * file-system provider adds a symbolic-link check on the device.
 */

/**
 * `path` as an absolute, normalised path, or an error when it leaves every
 * directory in `roots`. A relative path is taken from `base`; a `file://`
 * address is decoded first; `.` and `..` are resolved here, so `..` cannot
 * climb out of a root.
 */
export function confinePath(
  path: string,
  roots: readonly string[],
  base: string,
): string {
  const refuse = (): never => {
    throw new Error('Path is outside the app directories: ' + path);
  };
  let value = path;
  if (/^file:\/\//i.test(value)) {
    try {
      value = decodeURIComponent(value.slice(7));
    } catch {
      refuse();
    }
  }
  if (value === '' || value.includes('\0')) refuse();
  if (!value.startsWith('/')) value = base + '/' + value;
  const parts: string[] = [];
  for (const part of value.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (!parts.length) refuse();
      parts.pop();
    } else parts.push(part);
  }
  const resolved = '/' + parts.join('/');
  if (!isInside(resolved, roots)) refuse();
  return resolved;
}

/** Whether a normalised absolute path is one of `roots` or below one. */
export function isInside(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => {
    const clean = root.replace(/\/+$/, '');
    return clean !== '' && (path === clean || path.startsWith(clean + '/'));
  });
}
