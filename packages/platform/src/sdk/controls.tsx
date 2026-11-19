import {
  createContext,
  createEffect,
  onCleanup,
  useContext,
  type JSXElement,
} from 'solid-js';
import type { Rect } from './input.js';
import type { EditorHost, EditorOptions } from './editor.js';

export type ControlKind = 'button' | 'switch' | 'slider' | 'progress' | 'label';
export interface ControlProps {
  bounds: Rect;
  label: string;
  disabled?: boolean;
  value?: number;
  min?: number;
  max?: number;
  onActivate?(): void;
  onValue?(value: number): void;
}
export interface ControlHandle {
  update(props: ControlProps): void;
  focus(): void;
  dispose(): void;
}
export interface ControlSurface extends EditorHost {
  create(kind: ControlKind): ControlHandle;
}
const Surface = createContext<ControlSurface>();
// Where text fields get their editors: the control surface, or a host's
// `text` on a host that has native text entry and no other native control.
const Editors = createContext<EditorHost>();
/**
 * Gives the controls below it their host. `surface` serves every control;
 * `text` (a host context's `text`) is enough for `TextField`, `SearchField`
 * and `TextArea`, and is used for them when both are given.
 */
export function Controls(props: {
  surface?: ControlSurface;
  text?: EditorHost;
  children?: JSXElement;
}) {
  return (
    <Surface.Provider value={props.surface}>
      <Editors.Provider value={props.text ?? props.surface}>
        {props.children}
      </Editors.Provider>
    </Surface.Provider>
  );
}
function useSurface() {
  const s = useContext(Surface);
  if (!s) throw new Error('Controls require a host control surface');
  return s;
}
function control(kind: ControlKind, props: ControlProps) {
  const handle = useSurface().create(kind);
  createEffect(() => handle.update({ ...props, bounds: { ...props.bounds } }));
  onCleanup(() => handle.dispose());
  return null;
}
export const Button = (props: ControlProps) => control('button', props);
export const Toggle = (props: ControlProps) => control('switch', props);
export const Slider = (props: ControlProps) => control('slider', props);
export const Progress = (props: ControlProps) => control('progress', props);
export const Label = (props: ControlProps) => control('label', props);

export function TextField(
  props: EditorOptions & { bounds: Rect; autofocus?: boolean },
) {
  const host = useContext(Editors);
  if (!host) throw new Error('Text fields require a host editor');
  const editor = host.createEditor(props);
  createEffect(() => editor.setBounds({ ...props.bounds }));
  createEffect(() => {
    if (props.value !== undefined) editor.setValue(props.value);
  });
  if (props.autofocus) editor.focus();
  onCleanup(() => editor.dispose());
  return null;
}

/** Native search field (`purpose: 'search'`), sharing the editor host. */
export function SearchField(
  props: EditorOptions & { bounds: Rect; autofocus?: boolean },
) {
  return <TextField {...props} purpose="search" multiline={false} />;
}

/** Native multiline editor (`TextView` on Android/iOS, textarea on web). */
export function TextArea(
  props: EditorOptions & { bounds: Rect; autofocus?: boolean },
) {
  return <TextField {...props} multiline />;
}
