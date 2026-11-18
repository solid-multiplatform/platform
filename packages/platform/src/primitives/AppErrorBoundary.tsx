import type { JSX } from 'solid-js';
import { ErrorBoundary } from 'solid-js';
import { reportCrash } from '../sdk/crash.js';
import { ListState } from './ListState.jsx';

export interface AppErrorBoundaryProps {
  children?: JSX.Element;
  title?: string;
  message?: string;
  actionLabel?: string;
  /** Called after the error is reported, with the boundary's reset function. */
  onError?(error: unknown, reset: () => void): void;
}

/**
 * App-level error boundary with the standard recovery surface. The render
 * error is sent to the installed crash reporter, the fallback uses
 * `ListState` and "Try again" resets the boundary so the subtree re-renders.
 */
export function AppErrorBoundary(
  props: AppErrorBoundaryProps,
): JSX.Element {
  let reported: unknown;
  return (
    <ErrorBoundary
      fallback={(error, reset) => {
        if (reported !== error) {
          reported = error;
          // Report outside render; a reporter may mutate app state.
          queueMicrotask(() => {
            reportCrash(error, { tags: { boundary: 'AppErrorBoundary' } });
            props.onError?.(error, reset);
          });
        }
        return (
          <ListState
            status="error"
            title={props.title ?? 'Something went wrong'}
            message={props.message ?? 'The app hit an unexpected error.'}
            actionLabel={props.actionLabel ?? 'Try again'}
            onAction={() => reset()}
          />
        );
      }}
    >
      {props.children}
    </ErrorBoundary>
  );
}
