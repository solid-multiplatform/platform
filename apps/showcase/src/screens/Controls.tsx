/** Checkbox, Radio, Select, Menu, Toast, Tooltip and the host's TextField. */
import { createSignal, For, Show } from 'solid-js';
import type { ElementNode } from '@solid-multiplatform/platform';
import { Controls, TextField } from '@solid-multiplatform/platform/controls';
import {
  Checkbox,
  Menu,
  Radio,
  Select,
  Toast,
  Tooltip,
} from '@solid-multiplatform/platform/primitives';
import { useShowcase } from '../env';
import { Button, MUTED, Screen, sceneRect } from '../ui';

const QUALITIES = ['SD', 'HD', '4K'] as const;
const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'French' },
  { value: 'ja', label: 'Japanese' },
];
const NOWHERE = { x: 0, y: 0, width: 0, height: 0 };

export function ControlsScreen() {
  const { env } = useShowcase();
  const [subtitles, setSubtitles] = createSignal(true);
  const [quality, setQuality] = createSignal<(typeof QUALITIES)[number]>('HD');
  const [language, setLanguage] = createSignal('en');
  const [menu, setMenu] = createSignal(false);
  const [toast, setToast] = createSignal(false);
  const [tip, setTip] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  const [name, setName] = createSignal('');
  const [last, setLast] = createSignal('nothing yet');
  let menuButton: ElementNode | undefined;
  let tipButton: ElementNode | undefined;
  let fieldButton: ElementNode | undefined;
  const rectOf = (node: ElementNode | undefined) =>
    node ? sceneRect(node) : NOWHERE;
  const fieldBounds = () => {
    const rect = rectOf(fieldButton);
    return { ...rect, x: rect.x + rect.width + 16, width: 320 };
  };

  return (
    <Screen
      title="Controls"
      gap={8}
      overlays={
        <>
          <Menu
            visible={menu}
            anchor={() => rectOf(menuButton)}
            label="Example menu"
            items={[
              { label: 'Rename', onSelect: () => setLast('menu: Rename') },
              { label: 'Share', onSelect: () => setLast('menu: Share') },
              { label: 'Delete', disabled: true },
            ]}
            onRequestClose={() => setMenu(false)}
          />
          <Toast
            visible={toast}
            message="Saved. This toast leaves by itself."
            duration={2500}
            onDismiss={() => setToast(false)}
          />
          <Tooltip
            visible={tip}
            anchor={() => rectOf(tipButton)}
            placement="bottom"
            label="A tooltip never takes focus"
          />
          <Show when={editing() && env.controls}>
            {(surface) => (
              <Controls surface={surface()}>
                <TextField
                  label="Name"
                  bounds={fieldBounds()}
                  value={name()}
                  autofocus
                  onChange={setName}
                  onSubmit={() => setEditing(false)}
                  onBlur={() => setEditing(false)}
                />
              </Controls>
            )}
          </Show>
        </>
      }
    >
      <Checkbox label="Subtitles" checked={subtitles} onChange={setSubtitles} />
      <For each={QUALITIES}>
        {(option) => (
          <Radio
            label={option}
            selected={() => quality() === option}
            onSelect={() => setQuality(option)}
          />
        )}
      </For>
      <Select
        label="Language"
        value={language}
        options={LANGUAGES}
        onChange={setLanguage}
      />
      <Button
        ref={(node) => {
          menuButton = node;
        }}
        label="Open menu"
        onEnter={() => setMenu(true)}
      />
      <Button label="Show toast" onEnter={() => setToast(true)} />
      <Button
        ref={(node) => {
          tipButton = node;
        }}
        label="Tooltip while focused"
        onFocus={() => setTip(true)}
        onBlur={() => setTip(false)}
      />
      <Button
        ref={(node) => {
          fieldButton = node;
        }}
        label={
          env.controls
            ? `Text field: ${name() || 'empty'}`
            : 'Text field: no text entry on this host'
        }
        onEnter={() => {
          setEditing(env.controls !== undefined);
        }}
      />
      <text
        skipFocus
        role="status"
        ariaLabel={`Subtitles ${subtitles() ? 'on' : 'off'}, ${quality()}, ${language()}. Last: ${last()}`}
        fontSize={20}
        color={MUTED}
      >
        {`Subtitles ${subtitles() ? 'on' : 'off'}, ${quality()}, ${language()}. Last: ${last()}`}
      </text>
      <text skipFocus fontSize={16} color={MUTED}>
        Select and Menu: Enter opens on the current choice, Up and Down move,
        Enter chooses, Back closes.
      </text>
    </Screen>
  );
}
