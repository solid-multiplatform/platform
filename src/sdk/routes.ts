/** Extract `:param` names from a route pattern at the type level. */
export type RouteParamNames<Pattern extends string> =
  Pattern extends `${string}:${infer Rest}`
    ? Rest extends `${infer Name}/${infer Tail}`
      ? Name | RouteParamNames<`/${Tail}`>
      : Rest extends `${infer Name}?${string}`
        ? Name
        : Rest extends `${infer Name}`
          ? Name
          : never
    : never;

export type RouteParams<Pattern extends string> = {
  [Name in RouteParamNames<Pattern>]: string | number;
};

/**
 * Type-safe route map. Declare paths once with `as const`; `buildRoute` then
 * requires exactly the parameters in the pattern.
 *
 * ```ts
 * const routes = {
 *   library: '/library',
 *   player: '/player/:id',
 * } as const;
 * const href = buildRoute(routes.player, { id: 42 }); // '/player/42'
 * ```
 */
export function buildRoute<Pattern extends string>(
  pattern: Pattern,
  params?: RouteParams<Pattern>,
): string {
  return (
    pattern
      .replace(/:([A-Za-z0-9_]+)\??/g, (match, name: string) => {
        const value = params?.[name as keyof RouteParams<Pattern>];
        if (value === undefined) {
          if (match.endsWith('?')) return '';
          throw new Error(`Missing route parameter: ${name}`);
        }
        return encodeURIComponent(String(value));
      })
      .replace(/\/+$/, '') || '/'
  );
}

/**
 * Match a concrete path against a pattern. Returns decoded parameters or
 * null. `*` matches the remainder of the path.
 */
export function matchRoute<Pattern extends string>(
  pattern: Pattern,
  path: string,
): RouteParams<Pattern> | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('?')[0]!.split('/').filter(Boolean);
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const expected = patternParts[i]!;
    if (expected === '*') {
      params['*'] = pathParts.slice(i).map(decodeURIComponent).join('/');
      return params as RouteParams<Pattern>;
    }
    const actual = pathParts[i];
    if (actual === undefined) {
      if (expected.endsWith('?')) return params as RouteParams<Pattern>;
      return null;
    }
    if (expected.startsWith(':')) {
      const name = expected.slice(1).replace(/\?$/, '');
      params[name] = decodeURIComponent(actual);
      continue;
    }
    if (expected !== actual) return null;
  }
  return pathParts.length === patternParts.length
    ? (params as RouteParams<Pattern>)
    : null;
}
