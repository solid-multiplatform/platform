/**
 * The generated app shell's one exit confirmation. Screen history's root
 * policy `confirm-exit` opens it; the shell renders it so no app supplies its
 * own Alert. Back while it is open is the modal's Back and only cancels.
 */
import { Show, type JSX } from 'solid-js';
import { Alert } from '../primitives/Alert.jsx';
import {
  cancelExitConfirmation,
  confirmExitConfirmation,
  pendingExitConfirmation,
} from '../primitives/screenHistory.js';

export function ExitConfirm(): JSX.Element {
  return (
    <Show when={pendingExitConfirmation()}>
      <Alert
        visible
        title="Exit?"
        message="Do you want to leave the app?"
        confirmLabel="Exit"
        cancelLabel="Cancel"
        onConfirm={confirmExitConfirmation}
        onCancel={cancelExitConfirmation}
        onRequestClose={cancelExitConfirmation}
      />
    </Show>
  );
}

/** Wraps the app with the framework-owned overlays. */
export function AppShell(props: { children: JSX.Element }): JSX.Element {
  return (
    <>
      {props.children}
      <ExitConfirm />
    </>
  );
}
