import { View } from '@nativescript/core';
import { NativePlayer, PlayerOperationError } from './native.mjs';

export function createApplePlayer(root, { target = 'ios', bounds } = {}) {
  return new NativePlayer(
    target,
    'avplayer',
    (_req, emit) => {
      const player = AVPlayer.new(),
        layer = AVPlayerLayer.playerLayerWithPlayer(player);
      class Surface extends View {
        createNativeView() {
          return UIView.new();
        }
      }
      const view = new Surface();
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
      const layout = () => {
        if (view.ios) {
          if (!layer.superlayer) view.ios.layer.addSublayer(layer);
          layer.frame = view.ios.bounds;
        }
      };
      view.on('layoutChanged', layout);
      root.insertChild(view, 0);
      layout();
      let timer, ended, item, observer;
      const trackMap = new Map();
      function tracks() {
        const result = {
          audio: [],
          text: [],
          selectedAudioId: null,
          selectedTextId: null,
        };
        trackMap.clear();
        for (const [kind, type] of [
          ['audio', AVMediaCharacteristicAudible],
          ['text', AVMediaCharacteristicLegible],
        ]) {
          const group =
            item.asset.mediaSelectionGroupForMediaCharacteristic(type);
          if (!group) continue;
          const selected =
            item.currentMediaSelection.selectedMediaOptionInMediaSelectionGroup(
              group,
            );
          for (let i = 0; i < group.options.count; i++) {
            const option = group.options.objectAtIndex(i),
              id = kind + ':' + i;
            trackMap.set(id, { option, group, kind });
            result[kind].push({
              id,
              label: option.displayName,
              language: option.extendedLanguageTag ?? undefined,
              available: option.playable,
            });
            if (option.isEqual(selected))
              result[kind === 'audio' ? 'selectedAudioId' : 'selectedTextId'] =
                id;
          }
        }
        emit({ tracks: result });
      }
      function select(kind, id) {
        const group = item.asset.mediaSelectionGroupForMediaCharacteristic(
          kind === 'audio'
            ? AVMediaCharacteristicAudible
            : AVMediaCharacteristicLegible,
        );
        const entry = id === null ? null : trackMap.get(id);
        if (
          !group ||
          (id !== null && (!entry?.option.playable || entry.kind !== kind))
        )
          throw new PlayerOperationError(
            'unsupported-operation',
            'Unavailable track',
          );
        item.selectMediaOptionInMediaSelectionGroup(
          entry?.option ?? null,
          group,
        );
        tracks();
      }
      const clock = () => {
        const pos = CMTimeGetSeconds(player.currentTime()),
          dur = CMTimeGetSeconds(item.duration);
        emit({
          time: {
            positionSeconds: Number.isFinite(pos) ? pos : 0,
            durationSeconds: Number.isFinite(dur) ? dur : null,
          },
        });
      };
      return {
        prepare(url) {
          const source = NSURL.URLWithString(url);
          if (!source)
            throw new PlayerOperationError(
              'prepare-failed',
              'Invalid media URL',
            );
          item = AVPlayerItem.playerItemWithURL(source);
          player.replaceCurrentItemWithPlayerItem(item);
          ended =
            NSNotificationCenter.defaultCenter.addObserverForNameObjectQueueUsingBlock(
              AVPlayerItemDidPlayToEndTimeNotification,
              item,
              NSOperationQueue.mainQueue,
              () => emit({ state: 'ended' }),
            );
          return new Promise((resolve, reject) => {
            timer = setInterval(() => {
              if (item.status === 2) {
                clearInterval(timer);
                const error = new PlayerOperationError(
                  'prepare-failed',
                  'AVPlayer item failed',
                );
                emit({ state: 'error', error: error.toFailure() });
                reject(error);
              }
              if (item.status === 1) {
                clearInterval(timer);
                clock();
                tracks();
                observer =
                  player.addPeriodicTimeObserverForIntervalQueueUsingBlock(
                    CMTimeMake(1, 1),
                    NSOperationQueue.mainQueue,
                    clock,
                  );
                resolve();
              }
            }, 50);
          });
        },
        selectAudioTrack: (id) => select('audio', id),
        selectTextTrack: (id) => select('text', id),
        play() {
          player.play();
          emit({ state: 'playing' });
        },
        pause() {
          player.pause();
          emit({ state: 'paused' });
        },
        seek(s) {
          return new Promise((resolve, reject) =>
            player.seekToTimeCompletionHandler(
              CMTimeMakeWithSeconds(s, 600),
              (done) =>
                done
                  ? resolve()
                  : reject(
                      new PlayerOperationError(
                        'seek-failed',
                        'Seek interrupted',
                      ),
                    ),
            ),
          );
        },
        setVolume(v) {
          player.volume = v;
        },
        setMuted(v) {
          player.muted = v;
        },
        setPictureMode(mode) {
          layer.videoGravity =
            mode === 'fill'
              ? AVLayerVideoGravityResizeAspectFill
              : AVLayerVideoGravityResizeAspect;
        },
        dispose() {
          clearInterval(timer);
          if (ended) NSNotificationCenter.defaultCenter.removeObserver(ended);
          if (observer) player.removeTimeObserver(observer);
          player.pause();
          player.replaceCurrentItemWithPlayerItem(null);
          view.off('layoutChanged', layout);
          layer.removeFromSuperlayer();
          root.removeChild(view);
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
