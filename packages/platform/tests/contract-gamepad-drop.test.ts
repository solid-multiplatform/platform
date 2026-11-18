import * as v from 'vitest';
import {
  bindGamepadEvents,
  gamepadEdges,
  readGamepads,
  type GamepadSnapshot,
} from '../src/sdk/gamepad.js';
import { bindFileDrop, pickedFileFromWeb } from '../src/sdk/files.js';

const snapshot = (pressed: boolean[], index = 0): GamepadSnapshot => ({
  index,
  id: 'pad',
  mapping: 'standard',
  axes: [0, 0],
  buttons: pressed.map((value) => ({ pressed: value, value: value ? 1 : 0 })),
});

v.describe('gamepad helpers', () => {
  v.it('computes button edges', () => {
    const first = gamepadEdges(undefined, snapshot([false, true, false]));
    v.expect(first).toEqual({ pressed: [1], released: [] });
    const next = gamepadEdges(
      snapshot([false, true, false]),
      snapshot([true, true, false]),
    );
    v.expect(next).toEqual({ pressed: [0], released: [] });
    const released = gamepadEdges(
      snapshot([true, true, false]),
      snapshot([false, false, true]),
    );
    v.expect(released).toEqual({ pressed: [2], released: [0, 1] });
  });

  v.it('reads connected pads without scheduling frames', () => {
    const original = navigator.getGamepads;
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [
        null,
        {
          index: 1,
          id: 'usb pad',
          mapping: 'standard',
          axes: [0.5, -0.5],
          buttons: [{ pressed: true, value: 1 }],
        },
      ],
    });
    v.expect(readGamepads()).toEqual([
      {
        index: 1,
        id: 'usb pad',
        mapping: 'standard',
        axes: [0.5, -0.5],
        buttons: [{ pressed: true, value: 1 }],
      },
    ]);
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: original,
    });
  });

  v.it('forwards connect/disconnect events', () => {
    const target = new EventTarget();
    const connects: string[] = [];
    const disconnects: number[] = [];
    const dispose = bindGamepadEvents(
      {
        onConnect: (pad) => connects.push(pad.id),
        onDisconnect: (pad) => disconnects.push(pad.index),
      },
      target,
    );
    const connected = new Event('gamepadconnected');
    Object.defineProperty(connected, 'gamepad', {
      value: {
        index: 2,
        id: 'living-room',
        mapping: 'standard',
        axes: [],
        buttons: [],
      },
    });
    target.dispatchEvent(connected);
    const disconnected = new Event('gamepaddisconnected');
    Object.defineProperty(disconnected, 'gamepad', {
      value: {
        index: 2,
        id: 'living-room',
        mapping: 'standard',
        axes: [],
        buttons: [],
      },
    });
    target.dispatchEvent(disconnected);
    v.expect(connects).toEqual(['living-room']);
    v.expect(disconnects).toEqual([2]);
    dispose();
  });
});

v.describe('file drop', () => {
  v.it('wraps dropped files and prevents the browser default', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    const received: string[] = [];
    const dispose = bindFileDrop(target, async (files) => {
      received.push(files[0]!.name);
      received.push(await files[0]!.text());
    });

    const over = new Event('dragover', { cancelable: true });
    target.dispatchEvent(over);
    v.expect(over.defaultPrevented).toBe(true);

    const drop = new Event('drop', { cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', {
      value: {
        files: [
          {
            name: 'note.txt',
            type: 'text/plain',
            size: 5,
            text: async () => 'hello',
            arrayBuffer: async () => new Uint8Array([104]).buffer,
          },
        ],
      },
    });
    target.dispatchEvent(drop);
    await new Promise((resolve) => setTimeout(resolve, 0));
    v.expect(drop.defaultPrevented).toBe(true);
    v.expect(received).toEqual(['note.txt', 'hello']);
    dispose();
    target.remove();
  });

  v.it('wraps a web File into the portable shape', async () => {
    const file = {
      name: 'a.bin',
      type: 'application/octet-stream',
      size: 2,
      text: async () => 'ab',
      arrayBuffer: async () => new Uint8Array([0, 255]).buffer,
    } as unknown as File;
    const picked = pickedFileFromWeb(file);
    v.expect(picked).toMatchObject({
      name: 'a.bin',
      type: 'application/octet-stream',
      size: 2,
    });
    v.expect(await picked.text()).toBe('ab');
    v.expect(Array.from(await picked.bytes())).toEqual([0, 255]);
  });
});
