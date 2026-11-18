import { createAndroidPlayer } from '@solid-multiplatform/video/android';

export async function checkAndroidMedia(host) {
  const player = createAndroidPlayer(host.root, { target: host.target });
  try {
    await player.open({
      url: 'asset:///app/caption.mp4',
      kind: 'vod',
      paused: true,
      adoptEngineDuration: true,
    });
    const track = player.snapshot.tracks.text.find((item) => item.available);
    if (!track) throw new Error('Caption track missing');
    await player.selectTextTrack(track.id);
    await player.play();
    let view;
    host.root.eachChildView((child) => {
      if (child.android?.getPlayer?.()) view = child.android;
      return true;
    });
    if (!view?.getSubtitleView())
      throw new Error('Native subtitle view missing');
    const controllerId = view
      .getResources()
      .getIdentifier(
        'exo_controller',
        'id',
        view.getContext().getPackageName(),
      );
    if (view.findViewById(controllerId))
      throw new Error('Unused transport controller inflated');
    for (let attempt = 0; attempt < 30; attempt++) {
      const cues = view.getPlayer().getCurrentCues().cues;
      if (
        cues.size() &&
        String(cues.get(0).text) === 'Solid caption sample' &&
        player.snapshot.time.positionSeconds > 0 &&
        player.snapshot.tracks.selectedTextId === track.id
      ) {
        await player.pause();
        return 'Native captions and playback verified';
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error('Native player did not present the selected cue');
  } finally {
    await player.dispose();
  }
}
