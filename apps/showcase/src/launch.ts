/**
 * Launch parameters, the same on every host. Each host hands over whatever it
 * was started with and this module reads it:
 *
 * - web: the page's query string (`?probe=1`);
 * - a deep link or a Roku/Android launch argument list: `probe=1&…`;
 * - desktop: the argument vector (`--probe`, `--probe=1`, `probe`);
 * - a host that already has key/value pairs: the record itself.
 */
export interface LaunchParams {
  /** Run every unattended probe, report one JSON document. */
  probe: boolean;
}

export type LaunchInput =
  | string
  | readonly string[]
  | Readonly<Record<string, unknown>>
  | null
  | undefined;

const truthy = (value: unknown): boolean =>
  value !== undefined &&
  value !== null &&
  value !== false &&
  !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());

function pairs(input: LaunchInput): Record<string, unknown> {
  if (input === undefined || input === null) return {};
  if (typeof input === 'object' && !Array.isArray(input))
    return input as Record<string, unknown>;
  const parts =
    typeof input === 'string'
      ? input.replace(/^[^?#]*[?#]/, '').split(/[&\s]+/)
      : (input as readonly string[]);
  const found: Record<string, unknown> = {};
  for (const part of parts) {
    const text = part.replace(/^-+/, '');
    if (text === '') continue;
    const at = text.indexOf('=');
    if (at === -1) found[text] = true;
    else found[text.slice(0, at)] = text.slice(at + 1);
  }
  return found;
}

export function parseLaunch(input: LaunchInput): LaunchParams {
  return { probe: truthy(pairs(input).probe) };
}
