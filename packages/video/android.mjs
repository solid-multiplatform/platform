import { Application, View } from '@nativescript/core';
import { NativePlayer, PlayerOperationError } from './native.mjs';
import { pendingAndroidDriver } from './android-driver.mjs';

function bindEngine(root, bounds, context, player, emit, preparedView) {
  class Surface extends View {
    createNativeView() {
      if (preparedView) {
        const initial = preparedView;
        preparedView = undefined;
        return initial;
      }
      const layout = context
        .getResources()
        .getIdentifier(
          'solid_multiplatform_video_player',
          'layout',
          context.getPackageName(),
        );
      // Hosts which bundle the JS adapter without its Android resources can
      // still provide Media3 themselves.
      return layout
        ? android.view.LayoutInflater.from(context).inflate(layout, null)
        : new androidx.media3.ui.PlayerView(context);
    }
  }
  const view = new Surface();
  let disposed = false;
  if (bounds) {
    view.horizontalAlignment = 'left';
    view.verticalAlignment = 'top';
    Object.assign(view, {
      marginLeft: bounds.x,
      marginTop: bounds.y,
      width: bounds.width,
      height: bounds.height,
    });
  }
  const loaded = () => {
    if (disposed) return;
    view.android.setUseController(false);
    view.android.setPlayer(player);
  };
  let ready,
    failed,
    timer,
    volume = 1,
    muted = false;
  const time = () =>
    emit({
      time: {
        positionSeconds: Math.max(0, player.getCurrentPosition() / 1000),
        durationSeconds:
          player.getDuration() > 0 ? player.getDuration() / 1000 : null,
        seekable: player.isCurrentMediaItemSeekable(),
      },
    });
  let trackMap = new Map();
  const tracks = () => {
    const groups = player.getCurrentTracks().getGroups();
    const snapshot = {
      audio: [],
      text: [],
      selectedAudioId: null,
      selectedTextId: null,
    };
    trackMap = new Map();
    for (let g = 0; g < groups.size(); g++) {
      const group = groups.get(g),
        type = group.getType();
      if (type !== 1 && type !== 3) continue;
      for (let i = 0; i < group.length; i++) {
        const f = group.getTrackFormat(i),
          kind = type === 1 ? 'audio' : 'text',
          id = kind + ':' + g + ':' + i;
        const available = group.isTrackSupported(i);
        trackMap.set(id, { group, i, type, available });
        snapshot[kind].push({
          id,
          label: f.label ?? f.language ?? kind,
          language: f.language ?? undefined,
          available,
        });
        if (group.isTrackSelected(i))
          snapshot[type === 1 ? 'selectedAudioId' : 'selectedTextId'] = id;
      }
    }
    emit({ tracks: snapshot });
  };
  const select = (type, id) => {
    const builder = player
      .getTrackSelectionParameters()
      .buildUpon()
      .clearOverridesOfType(type);
    if (id === null) builder.setTrackTypeDisabled(type, true);
    else {
      const found = trackMap.get(id);
      if (!found?.available || found.type !== type)
        throw new PlayerOperationError(
          'unsupported-operation',
          'Unavailable track',
        );
      builder
        .setTrackTypeDisabled(type, false)
        .setOverrideForType(
          new androidx.media3.common.TrackSelectionOverride(
            found.group.getMediaTrackGroup(),
            found.i,
          ),
        );
    }
    player.setTrackSelectionParameters(builder.build());
  };
  const listener = new androidx.media3.common.Player.Listener({
    onTracksChanged: tracks,
    onPlaybackStateChanged(state) {
      if (state === 3) {
        time();
        ready?.();
      } else if (state === 4) emit({ state: 'ended' });
      else if (state === 2) emit({ state: 'buffering' });
    },
    onIsPlayingChanged(playing) {
      if (playing) emit({ state: 'playing' });
      else if (player.getPlaybackState() === 3) emit({ state: 'paused' });
    },
    onPlayerError() {
      const e = new PlayerOperationError(
        'prepare-failed',
        'Media3 playback failed',
      );
      emit({ state: 'error', error: e.toFailure() });
      failed?.(e);
    },
  });
  return {
    prepare(url) {
      return new Promise((resolve, reject) => {
        ready = resolve;
        failed = reject;
        root.insertChild(view, 0);
        if (disposed) return;
        if (view.android) loaded();
        else view.once('loaded', loaded);
        player.addListener(listener);
        timer = setInterval(time, 1000);
        player.setMediaItem(androidx.media3.common.MediaItem.fromUri(url));
        if (!disposed) player.prepare();
      });
    },
    selectAudioTrack: (id) => select(1, id),
    selectTextTrack: (id) => select(3, id),
    play: () => player.play(),
    pause: () => player.pause(),
    seek: (s) => player.seekTo(Math.round(s * 1000)),
    setPictureMode(mode) {
      view.android.setResizeMode(mode === 'fill' ? 4 : 0);
    },
    setVolume(v) {
      volume = v;
      player.setVolume(muted ? 0 : v);
    },
    setMuted(v) {
      muted = v;
      player.setVolume(v ? 0 : volume);
    },
    counters() {
      const counter = player.getVideoDecoderCounters?.();
      if (!counter) return {};
      counter.ensureUpdated();
      return {
        rendered: counter.renderedOutputBufferCount,
        dropped: counter.droppedBufferCount,
        skipped: counter.skippedOutputBufferCount,
      };
    },
    // A preview that is opened repeatedly can keep one engine and PlayerView
    // alive and simply detach it between sessions. This avoids inflating a
    // new PlayerView (and its first attach traversal) inside a key frame.
    detach() {
      if (view.parent === root) root.removeChild(view);
    },
    attach() {
      if (view.parent !== root) root.insertChild(view, 0);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearInterval(timer);
      failed?.(
        new PlayerOperationError('invalid-state', 'Playback interrupted'),
      );
      failed = ready = undefined;
      player.removeListener(listener);
      view.off('loaded', loaded);
      // Detach and stop pulling frames first. Media3's release() blocks on its
      // playback thread; running it inside an input frame stalls the compositor
      // for 60-115 ms. Keep main-looper ownership but defer the blocking part
      // until the current frame has been presented.
      if (view.parent === root) root.removeChild(view);
      const engine = player;
      const nativeView = view.android;
      // setPlayer(null) also detaches the surface and can block while the
      // player is playing. Move it out of the input frame together with the
      // blocking release.
      setTimeout(() => {
        nativeView?.setPlayer(null);
        engine.release();
      }, 0);
    },
  };
}

export function createAndroidPlayer(root, { target = 'android', bounds } = {}) {
  return new NativePlayer(
    target,
    'media3',
    (_request, emit) => {
      const context = Application.android.context;
      const bind = (engine, view) =>
        bindEngine(root, bounds, context, engine, emit, view);
      const factory =
        globalThis.dev?.solidmultiplatform?.video?.AndroidPlayerFactory;
      if (factory) {
        return pendingAndroidDriver(
          (ready, failed) =>
            factory.create(context, new factory.Callback({ ready, failed })),
          bind,
        );
      }
      const player = new androidx.media3.exoplayer.ExoPlayer.Builder(
        context,
      ).build();
      try {
        return bind(player);
      } catch (error) {
        player.release();
        throw error;
      }
    },
    {
      canSetVolume: true,
      canSelectTextTrack: true,
      canDisableTextTrack: true,
      canSelectAudioTrack: true,
    },
  );
}
