import { Application, File, knownFolders } from '@nativescript/core';
import { createSignal } from 'solid-js';
import { activeElement, type ElementNode } from '@solid-multiplatform/platform';
import { useFocusManager } from '@solid-multiplatform/platform/focusManager';
import { createNavigation } from '@solid-multiplatform/platform/navigation';
import { createAndroidPlayer } from '@solid-multiplatform/video/android';
import { mountGallery } from './gallery';

export function mount(_plugins, fontRoot, _input, host) {
  const history: object[] = [];
  const journal = File.fromPath(
    knownFolders.documents().path + '/mixed-events.json',
  );
  const record = (name: string, data: object = {}) => {
    history.push({
      name,
      bootMs: android.os.SystemClock.elapsedRealtime(),
      ...data,
    });
    // Event markers only. The animation loop performs no journal or tracing I/O.
    android.os.Trace.beginSection('SolidMixed.' + name);
    android.os.Trace.endSection();
    journal.writeTextSync(JSON.stringify(history));
  };
  const navigation = createNavigation({ path: 'gallery' });
  const page = () => navigation.route().path;
  const [selected, setSelected] = createSignal(false);
  const [running, setRunning] = createSignal(true);
  let first: ElementNode,
    detail: ElementNode,
    modal: ElementNode,
    transport: ElementNode;
  let player: ReturnType<typeof createAndroidPlayer> | undefined;
  let busy = false;

  function counters() {
    let result = {};
    host.root.eachChildView((child) => {
      const counter = child.android?.getPlayer?.()?.getVideoDecoderCounters?.();
      if (counter) {
        counter.ensureUpdated();
        result = {
          rendered: counter.renderedOutputBufferCount,
          dropped: counter.droppedBufferCount,
          skipped: counter.skippedOutputBufferCount,
        };
      }
      return true;
    });
    return result;
  }

  const focus = (node: ElementNode, event: string) => {
    node.setFocus();
    // setFocus commits with the framework's deferred layout and focus mutations.
    queueMicrotask(() => {
      if (activeElement() === node) record(event);
      else record('error', { message: 'Focus did not move to ' + event });
    });
    return true;
  };
  const right = () => {
    setSelected(true);
    return focus(detail, 'detail-focus');
  };
  const openModal = () => {
    navigation.push({ path: 'modal' });
    return focus(modal, 'modal');
  };

  async function play() {
    if (busy) return;
    busy = true;
    try {
      if (!player) {
        const size = host.root.getActualSize();
        player = createAndroidPlayer(host.root, {
          target: 'android-tv',
          bounds: {
            x: size.width * 0.35,
            y: size.height * 0.18,
            width: size.width * 0.6,
            height: size.height * 0.6,
          },
        });
        await player.open({
          url: 'asset:///app/gallery/clip.mp4',
          kind: 'vod',
          paused: true,
          adoptEngineDuration: true,
        });
        navigation.push({ path: 'player' });
        focus(transport, 'player-focus');
      }
      await player.play();
      record('play', {
        duration: player.snapshot.time.durationSeconds,
        audio: player.snapshot.tracks.selectedAudioId ?? null,
      });
    } catch (e) {
      record('error', { message: String(e) });
    } finally {
      busy = false;
    }
  }
  async function pause() {
    if (busy || !player) return;
    busy = true;
    try {
      await player.pause();
      record('pause', {
        position: player.snapshot.time.positionSeconds,
        ...counters(),
      });
    } catch (e) {
      record('error', { message: String(e) });
    } finally {
      busy = false;
    }
  }
  async function seek() {
    if (busy || !player) return;
    busy = true;
    try {
      await player.seek(2);
      record('seek', { requestedSeconds: 2 });
    } catch (e) {
      record('error', { message: String(e) });
    } finally {
      busy = false;
    }
  }
  const activate = () => {
    if (player?.snapshot.state === 'playing') void pause();
    else void play();
    return true;
  };
  const back = () => {
    if (busy || page() === 'gallery') return false;
    if (page() === 'player' && player) {
      const closing = player;
      record('player-exit', {
        position: closing.snapshot.time.positionSeconds,
        ...counters(),
      });
      player = undefined;
      void closing
        .dispose()
        .catch((e) => record('error', { message: String(e) }));
    }
    navigation.back();
    return page() === 'modal'
      ? focus(modal, 'modal-return')
      : focus(detail, 'gallery-return');
  };
  const suspend = () => {
    setRunning(false);
    record('suspend', { page: page() });
    if (player?.snapshot.state === 'playing') void pause();
  };
  const resume = () => {
    setRunning(true);
    record('resume', { page: page() });
  };
  Application.on('suspend', suspend);
  Application.on('resume', resume);
  const dispose = mountGallery(fontRoot, {
    galleryVisible: () => page() !== 'player',
    canScroll: () => running() && page() === 'gallery',
    render() {
      useFocusManager();
      return (
        <view width={1920} height={1080}>
          <view
            alpha={page() === 'gallery' ? 1 : 0}
            x={20}
            y={26}
            width={500}
            height={90}
          >
            <view
              ref={first}
              autofocus
              width={200}
              height={66}
              color={selected() ? 0x23364aff : 0x356496ff}
              onRight={right}
            >
              <text x={12} y={12} fontSize={30}>
                Gallery
              </text>
            </view>
            <view
              ref={detail}
              x={215}
              width={240}
              height={66}
              color={selected() ? 0x356496ff : 0x23364aff}
              onEnter={openModal}
              onLeft={() => {
                setSelected(false);
                return focus(first, 'gallery-focus');
              }}
              onRight={right}
            >
              <text x={12} y={12} fontSize={30}>
                Details
              </text>
            </view>
          </view>
          <view
            alpha={page() === 'modal' ? 1 : 0}
            width={1920}
            height={1080}
            color={0x00000099}
          >
            <view x={570} y={300} width={780} height={440} color={0x25384fff}>
              <text x={40} y={40} fontSize={54}>
                Playback details
              </text>
              <view
                ref={modal}
                x={40}
                y={245}
                width={340}
                height={86}
                color={0x356496ff}
                onEnter={() => {
                  void play();
                  return true;
                }}
                onBack={back}
              >
                <text x={20} y={16} fontSize={34}>
                  Play preview
                </text>
              </view>
            </view>
          </view>
          <view
            ref={transport}
            alpha={page() === 'player' ? 1 : 0}
            x={50}
            y={280}
            width={550}
            height={220}
            color={0x25384fff}
            onEnter={activate}
            onRight={() => {
              void seek();
              return true;
            }}
            onBack={back}
          >
            <text x={20} y={32} fontSize={44}>
              Preview
            </text>
            <text x={20} y={105} fontSize={28}>
              Select to play or pause
            </text>
          </view>
        </view>
      );
    },
  });
  return () => {
    Application.off('suspend', suspend);
    Application.off('resume', resume);
    if (player) void player.dispose();
    dispose();
  };
}
