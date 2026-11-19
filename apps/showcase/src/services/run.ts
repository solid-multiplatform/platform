/** Runs one row of the service table and keeps what each row last reported. */
import { createSignal } from 'solid-js';
import {
  CapabilityError,
  serviceAvailable,
  type ServiceName,
} from '@solid-multiplatform/platform/services';
import { failed, unverified, type Outcome } from '../probe/result';
import { serviceNames, serviceTable } from './table';

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** A refusal by the platform, as opposed to a broken service. */
function refused(error: unknown): boolean {
  const name = error instanceof Error ? error.name : '';
  return (
    name === 'NotAllowedError' ||
    name === 'SecurityError' ||
    /permission|denied|not allowed/i.test(message(error))
  );
}

/**
 * `attended` is true when a person activated the row: only then may a probe
 * prompt, vibrate or show something.
 */
export async function runProbe(
  name: ServiceName,
  attended: boolean,
): Promise<Outcome> {
  if (serviceAvailable(name) === 'unavailable')
    return { status: 'unavailable', detail: 'no provider installed' };
  const spec = serviceTable[name];
  const run = spec.probe ?? (attended ? spec.activate : undefined);
  if (run === undefined)
    return unverified(spec.manual ?? 'no harmless exercise exists');
  try {
    return await run();
  } catch (error) {
    // One operation of an installed service that this device lacks.
    if (error instanceof CapabilityError)
      return { status: 'unavailable', detail: message(error) };
    return refused(error)
      ? { status: 'denied', detail: message(error) }
      : failed(message(error));
  }
}

const [results, setResults] = createSignal<
  Partial<Record<ServiceName, Outcome>>
>({});

/** What each row last reported; empty until a row has run. */
export { results };

export async function runRow(
  name: ServiceName,
  attended: boolean,
): Promise<Outcome> {
  const outcome = await runProbe(name, attended);
  setResults((previous) => ({ ...previous, [name]: outcome }));
  return outcome;
}

/** Every row, unattended, one after the other. */
export async function runAllUnattended(): Promise<Record<string, Outcome>> {
  const all: Record<string, Outcome> = {};
  for (const name of serviceNames) all[name] = await runRow(name, false);
  return all;
}
