import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  menuItemsPayload,
  runMenuItem,
} from '@solid-multiplatform/platform/menus';

const helper = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'menu-helper.py',
);

/**
 * Start the GTK/AppIndicator helper. Returns undefined when Python, GTK or a
 * display is unavailable, so the app still runs without a tray. The provider
 * maps application menus and tray menus onto one native tray menu; selection
 * callbacks run in-process and the updated checked state is sent back.
 */
export async function createDesktopMenuProvider() {
  const child = spawn('python3', [helper], {
    stdio: ['pipe', 'pipe', 'ignore'],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });
  let application = null;
  let tray = null;
  let closed = false;
  let ready = false;

  const send = (payload) => {
    if (!closed && child.stdin.writable) {
      child.stdin.write(JSON.stringify(payload) + '\n');
    }
  };
  const refresh = () => {
    const items = tray?.menu ?? application?.items ?? [];
    send({
      type: 'menu',
      items: menuItemsPayload(items),
      icon: tray?.icon,
      tooltip: tray?.tooltip,
    });
  };
  const port = {
    setApplicationMenu(menu) {
      application = menu;
      refresh();
    },
    setTray(next) {
      tray = next;
      refresh();
    },
  };
  const dispose = () => {
    if (closed) return;
    send({ type: 'quit' });
    closed = true;
    setTimeout(() => child.kill(), 100).unref();
  };

  return new Promise((resolve) => {
    const lines = createInterface({ input: child.stdout });
    const finish = (value) => {
      clearTimeout(timer);
      if (!ready) {
        ready = true;
        resolve(value);
      }
    };
    const timer = setTimeout(() => {
      dispose();
      finish(undefined);
    }, 3000);
    timer.unref();
    lines.on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.type === 'ready') {
        finish({ port, dispose });
      } else if (message.type === 'select') {
        const items = tray?.menu ?? application?.items;
        if (items && runMenuItem(items, message.id)) refresh();
      }
    });
    child.once('error', () => {
      dispose();
      finish(undefined);
    });
    child.once('exit', () => {
      closed = true;
      finish(undefined);
    });
  });
}
