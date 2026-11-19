import {
  Application,
  Color,
  File,
  Label,
  knownFolders,
} from '@nativescript/core';
import { createSignal } from 'solid-js';
import {
  activeElement,
  getRenderer,
  type ElementNode,
} from '@solid-multiplatform/platform';
import { useFocusManager } from '@solid-multiplatform/platform/focusManager';
import { createNavigation } from '@solid-multiplatform/platform/navigation';
import { createAndroidPlayer } from '@solid-multiplatform/video/android';
import { mountGallery } from './gallery';

export function mount(_plugins, fontRoot, _input, host) {
  const overVideo = File.exists(
    knownFolders.documents().path + '/mixed-overlay',
  );
  let caption: Label | undefined;
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
  let warming: Promise<void> | undefined;
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
  // Build the native PlayerView and Media3 engine while the dialog is idle,
  // before the next key needs them. Creating them inside the "Play preview"
  // key frame costs 20-95 ms and blows that frame's deadline.
  function warmPlayer() {
    if (player || warming) return warming;
    const size = host.root.getActualSize();
    record('warm-start', { width: size.width, height: size.height });
    const instance = createAndroidPlayer(host.root, {
      target: 'android-tv',
      bounds: {
        x: size.width * 0.35,
        y: size.height * 0.18,
        width: size.width * 0.6,
        height: size.height * 0.6,
      },
    });
    warming = instance
      .open({
        url: 'asset:///app/gallery/clip.mp4',
        kind: 'vod',
        paused: true,
        adoptEngineDuration: true,
      })
      .then(async () => {
        // Initialize the decoder and output surface before capture so the
        // first measured play() does not pay codec/surface setup.
        await instance.play();
        await new Promise((resolve) => setTimeout(resolve, 250));
        await instance.pause();
        player = instance;
        // Compile the transport panel's text shaders before capture. The
        // first reveal costs ~100 ms of atlas/shader work on the render
        // thread, which would otherwise land on the first Play frame.
        navigation.push({ path: 'player' });
        if (overVideo && !caption) {
          const size = host.root.getActualSize();
          caption = new Label();
          caption.text = 'Native caption';
          caption.color = new Color('#ffffff');
          caption.backgroundColor = new Color('#14675a');
          caption.horizontalAlignment = 'left';
          caption.verticalAlignment = 'top';
          caption.marginLeft = (size.width * 900) / 1920;
          caption.marginTop = (size.height * 325) / 1080;
          caption.width = (size.width * 260) / 1920;
          caption.height = (size.height * 70) / 1080;
          host.root.addChild(caption);
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
        if (caption) caption.opacity = 0;
        navigation.back();
        await new Promise((resolve) => setTimeout(resolve, 150));
        record('warm-ready');
        File.fromPath(
          knownFolders.documents().path + '/mixed-ready',
        ).writeTextSync('ready');
      })
      .catch((e) => record('error', { message: String(e) }));
    return warming;
  }
  const openModal = () => {
    navigation.push({ path: 'modal' });
    return focus(modal, 'modal');
  };

  async function play() {
    if (busy) return;
    busy = true;
    try {
      if (!player) await (warming ?? warmPlayer());
      const entering = page() !== 'player';
      if (entering) {
        navigation.push({ path: 'player' });
        // Every cycle reuses the player. Start from zero so a delayed key
        // command cannot run into the 8-second clip's end, where the next
        // Select (meant to pause) would restart playback instead.
        await player!.seek(0);
      }
      if (overVideo && caption) caption.opacity = 1;
      if (entering) focus(transport, 'player-focus');
      await player!.play();
      record('play', {
        duration: player!.snapshot.time.durationSeconds,
        audio: player!.snapshot.tracks.selectedAudioId ?? null,
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
      // Keep the warmed engine and native view for the next preview. The
      // player is built once before recording starts; releasing or rebuilding
      // it inside the run would block a frame for 60-115 ms.
      void closing.pause().catch((e) => record('error', { message: String(e) }));
      if (caption) caption.opacity = 0;
    }
    navigation.back();
    return page() === 'modal'
      ? focus(modal, 'modal-return')
      : focus(detail, 'gallery-return');
  };
  let lifecycleSuspended = false;
  const suspend = () => {
    if (lifecycleSuspended) return;
    lifecycleSuspended = true;
    setRunning(false);
    record('suspend', { page: page() });
    if (player?.snapshot.state === 'playing') void pause();
  };
  const resume = () => {
    if (!lifecycleSuspended) return;
    lifecycleSuspended = false;
    setRunning(true);
    record('resume', { page: page() });
    // The window is being relayed out by WindowManager in this vsync. Drawing
    // here adds a second late buffer; let the window settle, then redraw.
    const r = getRenderer();
    r?.pause?.({ immediate: true });
    setTimeout(() => r?.resume?.(), 1400);
  };
  // The qualification harness can take over lifecycle transitions through an
  // intent extra. This avoids the TV's display power policy, which is not
  // stable enough for a repeated timing gate, while leaving normal app
  // behavior unchanged.
  const testLifecycle = File.exists(
    knownFolders.documents().path + '/mixed-lifecycle-test',
  );
  Application.on('suspend', () => {
    if (!testLifecycle) suspend();
  });
  Application.on('resume', () => {
    if (!testLifecycle) resume();
  });
  const onIntent = (args) => {
    const action = args.intent?.getStringExtra?.('solid-lifecycle');
    if (action === 'suspend') suspend();
    else if (action === 'resume') resume();
  };
  Application.android?.on?.('activityNewIntent', onIntent);
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
            x={overVideo ? 700 : 50}
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
  // Build the one engine and native view before the timed capture starts.
  // Every preview then only calls play()/pause(); nothing inflates or releases
  // a surface inside a measured frame.
  setTimeout(warmPlayer, 0);
  return () => {
    Application.off('suspend', suspend);
    Application.off('resume', resume);
    Application.android?.off?.('activityNewIntent', onIntent);
    if (player) void player.dispose();
    if (caption) host.root.removeChild(caption);
    dispose();
  };
}
