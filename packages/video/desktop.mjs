import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { NativePlayer, PlayerOperationError } from './native.mjs';

const failure = () =>
  new PlayerOperationError(
    'engine-unavailable',
    'The native video engine is unavailable.',
  );
/** MPV's native surface is embedded with the host's HWND or X11 Window ID. */
export function createDesktopPlayer(host, options = {}) {
  const wid = host.window?.nativeVideoId?.();
  if (!wid)
    throw new PlayerOperationError(
      'engine-unavailable',
      'Desktop video requires an embeddable native window.',
    );
  return new NativePlayer(
    'desktop',
    'mpv',
    (_request, emit) => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'solid-media-'));
      const address =
        process.platform === 'win32'
          ? '\\\\.\\pipe\\solid-media-' + randomUUID()
          : path.join(dir, 'control.sock');
      const proc = spawn(
        options.executable ?? 'mpv',
        [
          '--no-config',
          '--load-scripts=no',
          '--ytdl=no',
          '--idle=yes',
          '--pause=yes',
          '--no-terminal',
          '--osc=no',
          '--input-default-bindings=no',
          '--network-timeout=10',
          '--wid=' + wid,
          '--input-ipc-server=' + address,
        ],
        { stdio: 'ignore' },
      );
      const pending = new Map();
      let closed = false,
        dead = false,
        socket,
        ready,
        failOpen,
        sequence = 0,
        position = 0,
        duration = null;
      function abort() {
        dead = true;
        for (const { reject } of pending.values()) reject(failure());
        pending.clear();
        failOpen?.(failure());
        if (!closed) emit({ state: 'error', error: failure().toFailure() });
      }
      proc.once('error', abort);
      proc.once('exit', () => {
        abort();
        rmSync(dir, { recursive: true, force: true });
      });
      function send(command) {
        if (closed || dead || !socket) return Promise.reject(failure());
        return new Promise((resolve, reject) => {
          const id = ++sequence;
          pending.set(id, { resolve, reject });
          socket.write(
            JSON.stringify({ command, request_id: id }) + '\n',
            (error) => {
              if (error && pending.delete(id)) reject(failure());
            },
          );
        });
      }
      function message(line) {
        if (closed) return;
        let m;
        try {
          m = JSON.parse(line);
        } catch {
          abort();
          return;
        }
        if (m.request_id) {
          const record = pending.get(m.request_id);
          if (!record) return;
          pending.delete(m.request_id);
          if (m.error === 'success') record.resolve(m.data);
          else
            record.reject(
              new PlayerOperationError(
                'unsupported-operation',
                'Native playback command failed.',
              ),
            );
        }
        if (m.event === 'file-loaded') ready?.();
        if (m.event === 'end-file') {
          if (m.reason === 'error') abort();
          else if (m.reason === 'eof') emit({ state: 'ended' });
        }
        if (m.event === 'property-change') {
          if (m.name === 'track-list' && Array.isArray(m.data)) {
            const tracks = {
              audio: [],
              text: [],
              selectedAudioId: null,
              selectedTextId: null,
            };
            for (const row of m.data) {
              const kind = row.type === 'sub' ? 'text' : row.type;
              if (kind !== 'audio' && kind !== 'text') continue;
              const id = String(row.id);
              tracks[kind].push({
                id,
                label: row.title || row.lang || kind,
                language: row.lang,
                available: true,
              });
              if (row.selected)
                tracks[
                  kind === 'audio' ? 'selectedAudioId' : 'selectedTextId'
                ] = id;
            }
            emit({ tracks });
          }
          if (m.name === 'duration') duration = m.data > 0 ? m.data : null;
          if (m.name === 'time-pos' && typeof m.data === 'number') {
            position = m.data;
            emit({
              time: { positionSeconds: position, durationSeconds: duration },
            });
          }
          if (m.name === 'pause' && m.data !== undefined && !failOpen)
            emit({ state: m.data ? 'paused' : 'playing' });
        }
      }
      async function connect() {
        for (let i = 0; i < 100 && !closed && !dead; i++) {
          const s = net.createConnection(address);
          const ok = await new Promise((resolve) => {
            s.once('error', () => resolve(false));
            s.once('connect', () => resolve(true));
          });
          if (ok && !closed && !dead) {
            socket = s;
            s.on('error', abort);
            s.on('end', abort);
            createInterface({ input: s }).on('line', message);
            return;
          }
          s.destroy();
          await new Promise((r) => setTimeout(r, 25));
        }
        throw failure();
      }
      return {
        async prepare(url) {
          if (!['https:', 'http:', 'file:'].includes(new URL(url).protocol))
            throw new PlayerOperationError(
              'unsupported-format',
              'Unsupported media URL scheme',
            );
          await connect();
          for (const [i, key] of [
            'duration',
            'time-pos',
            'pause',
            'track-list',
          ].entries())
            await send(['observe_property', i + 1, key]);
          await new Promise((resolve, reject) => {
            ready = resolve;
            failOpen = reject;
            send(['loadfile', url, 'replace']).catch(reject);
          });
          ready = failOpen = undefined;
        },
        play: () => send(['set_property', 'pause', false]),
        pause: () => send(['set_property', 'pause', true]),
        seek: (s) => send(['seek', s, 'absolute+exact']),
        setMuted: (v) => send(['set_property', 'mute', v]),
        setVolume: (v) => send(['set_property', 'volume', v * 100]),
        selectAudioTrack: (id) => send(['set_property', 'aid', id]),
        selectTextTrack: (id) => send(['set_property', 'sid', id ?? 'no']),
        setPictureMode: (mode) =>
          send(['set_property', 'panscan', mode === 'fill' ? 1 : 0]),
        dispose() {
          closed = true;
          abort();
          socket?.destroy();
          proc.kill();
          if (proc.pid === undefined)
            rmSync(dir, { recursive: true, force: true });
        },
      };
    },
    {
      canSetVolume: true,
      canSelectTextTrack: true,
      canDisableTextTrack: true,
      canSelectAudioTrack: true,
    },
  );
}
