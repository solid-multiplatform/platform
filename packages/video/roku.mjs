import {
  createElement,
  insertNode,
  setProp,
  tmTransaction,
} from '@roku-sdk/solid';
import { NativePlayer, PlayerOperationError } from './native.mjs';

export function createRokuPlayer(
  parent,
  { x = 0, y = 0, width = 1920, height = 1080 } = {},
) {
  return new NativePlayer('roku', 'scenegraph', (_req, emit) => {
    const video = createElement('video'),
      content = createElement('contentNode');
    let settle,
      reject,
      position = 0,
      duration = null,
      live = true;
    const prop = (k, v) => setProp(video, k, v);
    const time = () =>
      emit({ time: { positionSeconds: position, durationSeconds: duration } });
    prop('translation', [x, y]);
    prop('width', width);
    prop('height', height);
    prop('enableUI', false);
    prop('notificationInterval', 1);
    let tracks={audio:[],text:[],selectedAudioId:null,selectedTextId:null};
    const publishTracks=change=>{if(live){tracks={...tracks,...change};emit({tracks});}};
    const available=(list,key)=>Array.isArray(list)?list.filter(t=>typeof t[key]==='string').map(t=>({
      id:t[key],label:t.Description||t.Name||t.Language||t[key],language:t.Language,available:true
    })):[];
    prop('onAvailableAudioTracks',list=>publishTracks({audio:available(list,'Track')}));
    prop('onAvailableSubtitleTracks',list=>publishTracks({text:available(list,'TrackName')}));
    prop('onAudioTrack',id=>publishTracks({selectedAudioId:id||null}));
    prop('onSubtitleTrack',id=>publishTracks({selectedTextId:id||null}));
    function select(kind,id){
      if(id!==null && !tracks[kind].some(t=>t.id===id))throw new PlayerOperationError('unsupported-operation','Track unavailable');
      prop(kind==='text'?'subtitleTrack':'audioTrack',id??'');
    }
    prop('onPosition', (n) => {
      if (live) {
        position = Math.max(0, Number(n) / 1000);
        time();
      }
    });
    prop('onDuration', (n) => {
      if (live) {
        duration = Number(n) > 0 ? Number(n) / 1000 : null;
        time();
      }
    });
    prop('onState', (s) => {
      if (!live) return;
      if (s === 'playing' || s === 'paused' || s === 'buffering')
        emit({ state: s });
      if (s === 'playing' || s === 'paused' || s === 'finished') settle?.();
      if (s === 'finished') emit({ state: 'ended' });
      if (s === 'error') {
        const e = new PlayerOperationError(
          'prepare-failed',
          'SceneGraph playback failed',
        );
        emit({ state: 'error', error: e.toFailure() });
        reject?.(e);
      }
    });
    insertNode(parent, video);
    return {
      prepare(url) {
        return new Promise((resolve, fail) => {
          settle = resolve;
          reject = fail;
          setProp(content, 'url', url);
          prop('content', content);
          prop('control', 'play');
        });
      },
      selectAudioTrack:id=>select('audio',id),selectTextTrack:id=>select('text',id),
      play: () => prop('control', 'resume'),
      pause: () => prop('control', 'pause'),
      seek: (seconds) => prop('seek', seconds),
      setMuted: (value) => prop('mute', value),
      setPictureMode: (mode) =>
        prop('scaleMode', mode === 'fill' ? 'zoomToFill' : 'scaleToFit'),
      dispose() {
        live = false;
        prop('control', 'stop');
        tmTransaction.removeNode(parent, video);
      },
    };
  },{canSelectAudioTrack:true,canSelectTextTrack:true,canDisableTextTrack:true});
}
