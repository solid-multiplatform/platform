import { File, knownFolders } from '@nativescript/core';
import { createApplePlayer } from '@solid-multiplatform/video/apple';
export function mount(plugins, _fonts, _input, host) {
  const output = File.fromPath(
    knownFolders.documents().path + '/plugin-result.txt',
  );
  const player = createApplePlayer(host.root, {
    target: host.target,
    bounds: { x: 12, y: 12, width: 220, height: 140 },
  });
  let active = true;
  async function check() {
    const result = await plugins.greeting.run();
    const path = knownFolders.currentApp().path + '/clip.mp4';
    await player.open({
      url: NSURL.fileURLWithPath(path).absoluteString,
      kind: 'vod',
      paused: true,
      adoptEngineDuration: true,
    });
    await player.play();
    for (let n = 0; n < 30 && player.snapshot.time.positionSeconds <= 0; n++)
      await new Promise((r) => setTimeout(r, 200));
    if (player.snapshot.time.positionSeconds <= 0)
      throw new Error('No AVPlayer progress');
    await player.pause();
    await player.seek(2);
    await player.stop();
    if (active) await output.writeText(result);
  }
  void check().catch((e) => output.writeText(String(e)));
  return () => {
    active = false;
    void player.dispose();
  };
}
