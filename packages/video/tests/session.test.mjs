import test from 'node:test';
import assert from 'node:assert/strict';
import {NativePlayer} from '../native.mjs';
import * as upstream from '../upstream/index.js';
import * as api from '../index.mjs';
test('preserves every pinned upstream export',()=>{for(const key of Object.keys(upstream))assert.equal(api[key],upstream[key]);});
test('late driver state cannot overwrite replacement or dispose',async()=>{
  const drivers=[];
  const p=new NativePlayer('ios','test',(request,notify)=>{
    const d={notify,prepare:()=>new Promise(resolve=>d.ready=resolve),play:()=>notify({state:'playing'}),seek:()=>{},dispose:()=>{d.closed=true;}};drivers.push(d);return d;
  });
  const first=p.open({url:'test:first',kind:'vod'});const second=p.open({url:'test:second',kind:'vod',timelineDurationSeconds:100,timelineOffsetSeconds:20});
  await assert.rejects(first,{code:'invalid-state'});assert.equal(drivers[0].closed,true);
  drivers[1].ready();await second;drivers[1].notify({time:{positionSeconds:7,durationSeconds:10}});
  assert.equal(p.snapshot.time.positionSeconds,27);assert.equal(p.snapshot.time.durationSeconds,100);
  drivers[0].notify({state:'error'});assert.equal(p.snapshot.state,'playing');
  await p.dispose();drivers[1].notify({state:'playing'});assert.equal(p.snapshot.state,'disposed');
});
test('native open rejects authorization before allocating a player',async()=>{
  const p=new NativePlayer('roku','test',()=>{throw Error('unexpected native allocation')});
  await assert.rejects(p.open({url:'https://example.invalid/safe.mp4',kind:'vod',authorization:{cookie:'test-cookie'}}),{code:'authorization-unsupported'});
  assert.equal(p.snapshot.state,'idle');
});
