import * as v from 'vitest';
import { createRokuPlayer } from '../../video/roku.mjs';

const parent = () => ({ children: [] });

v.describe('Roku video adapter', () => {
  v.it(
    'creates a SceneGraph Video node and controls playback/tracks',
    async () => {
      const root = parent();
      const player = createRokuPlayer(root, { width: 1280, height: 720 });
      v.expect(player.capabilities.canSelectAudioTrack).toBe(true);
      v.expect(player.capabilities.canSelectTextTrack).toBe(true);

      await player.open({
        url: 'https://example.test/movie.m3u8',
        kind: 'vod',
        paused: true,
      });
      v.expect(root.children).toHaveLength(1);
      const video = root.children[0];
      v.expect(video.type).toBe('video');
      v.expect(video.props.width).toBe(1280);
      v.expect(['ready', 'paused', 'playing']).toContain(player.snapshot.state);

      video.props.onAvailableAudioTracks([
        { Track: 'a1', Description: 'English', Language: 'en' },
      ]);
      video.props.onAvailableSubtitleTracks([
        { TrackName: 't1', Description: 'English CC', Language: 'en' },
      ]);
      v.expect(player.snapshot.tracks.audio[0]).toMatchObject({
        id: 'a1',
        label: 'English',
      });
      v.expect(player.snapshot.tracks.text[0]).toMatchObject({
        id: 't1',
        label: 'English CC',
      });

      await player.selectAudioTrack('a1');
      await player.selectTextTrack('t1');
      v.expect(video.props.audioTrack).toBe('a1');
      v.expect(video.props.subtitleTrack).toBe('t1');

      await player.seek(30);
      v.expect(video.props.seek).toBe(30);
      await player.setPictureMode('fill');
      v.expect(video.props.scaleMode).toBe('zoomToFill');

      player.dispose();
      v.expect(root.children).toHaveLength(0);
    },
  );

  v.it('rejects unavailable track ids', async () => {
    const root = parent();
    const player = createRokuPlayer(root);
    await player.open({ url: 'https://example.test/live.m3u8', kind: 'live' });
    await v
      .expect(player.selectTextTrack('missing'))
      .rejects.toThrowError(/Track unavailable/);
    player.dispose();
  });
});
