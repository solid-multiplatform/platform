import type {
  MediaAction,
  MediaSessionPort,
} from '@solid-multiplatform/platform/media';

// MPNowPlayingPlaybackState
const states = { none: 0, playing: 1, paused: 2 } as const;
const MPRemoteCommandHandlerStatusSuccess = 0;

/**
 * Now Playing metadata and the remote's transport commands (the Siri Remote,
 * Control Center, the lock screen, headphones). A command is enabled only
 * while the app has a handler for it. Artwork is not published.
 */
export function mediaSession(): MediaSessionPort {
  const command = (action: MediaAction): MPRemoteCommand => {
    const center = MPRemoteCommandCenter.sharedCommandCenter();
    switch (action) {
      case 'play':
        return center.playCommand;
      case 'pause':
        return center.pauseCommand;
      case 'stop':
        return center.stopCommand;
      case 'seekbackward':
        return center.skipBackwardCommand;
      case 'seekforward':
        return center.skipForwardCommand;
      case 'seekto':
        return center.changePlaybackPositionCommand;
      case 'nexttrack':
        return center.nextTrackCommand;
      case 'previoustrack':
        return center.previousTrackCommand;
    }
  };
  const targets = new Map<MediaAction, unknown>();
  const publish = (values: Record<string, string | number | undefined>) => {
    const center = MPNowPlayingInfoCenter.defaultCenter();
    const info = NSMutableDictionary.alloc<string, unknown>().init();
    if (center.nowPlayingInfo)
      info.addEntriesFromDictionary(center.nowPlayingInfo);
    for (const key of Object.keys(values)) {
      const value = values[key];
      if (value === undefined) info.removeObjectForKey(key);
      else info.setObjectForKey(value, key);
    }
    center.nowPlayingInfo = info;
  };
  return {
    setMetadata(metadata) {
      publish({
        [MPMediaItemPropertyTitle]: metadata.title,
        [MPMediaItemPropertyArtist]: metadata.artist,
        [MPMediaItemPropertyAlbumTitle]: metadata.album,
      });
    },
    setPlaybackState(state) {
      const center = MPNowPlayingInfoCenter.defaultCenter();
      center.playbackState = states[state];
      if (state === 'none') center.nowPlayingInfo = null;
      else
        publish({
          [MPNowPlayingInfoPropertyPlaybackRate]: state === 'playing' ? 1 : 0,
        });
    },
    setPositionState(state) {
      publish({
        [MPMediaItemPropertyPlaybackDuration]: state.duration,
        [MPNowPlayingInfoPropertyElapsedPlaybackTime]: state.position,
        [MPNowPlayingInfoPropertyPlaybackRate]: state.playbackRate ?? 1,
      });
    },
    setActionHandler(action, handler) {
      const remote = command(action);
      const previous = targets.get(action);
      if (previous !== undefined) {
        remote.removeTarget(previous);
        targets.delete(action);
      }
      remote.enabled = handler !== undefined;
      if (handler)
        targets.set(
          action,
          remote.addTargetWithHandler(() => {
            handler();
            return MPRemoteCommandHandlerStatusSuccess;
          }),
        );
    },
  };
}
