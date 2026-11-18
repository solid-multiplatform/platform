import path from 'node:path';
import { existsSync } from 'node:fs';
import { command, copy, framework, write } from './files.mjs';

export function buildDesktopUI(root, dir, work, launch) {
  command(
    'corepack',
    [
      'pnpm',
      'install',
      existsSync(path.join(dir, 'pnpm-lock.yaml'))
        ? '--frozen-lockfile'
        : '--no-frozen-lockfile',
    ],
    dir,
  );
  command(
    process.execPath,
    [path.join(framework, 'hosts/desktop/accessibility/build.mjs'), dir],
    dir,
  );
  if (process.platform === 'win32' && process.arch === 'x64')
    command(
      process.execPath,
      [path.join(framework, 'hosts/desktop/windows-runtime.mjs'), dir],
      dir,
    );
  copy(path.join(root, 'assets/fonts'), path.join(work, 'fonts'));
  for (const file of [
    'window.mjs',
    'angle.mjs',
    'graphics.mjs',
    'semantics.mjs',
    'editors.mjs',
    'menus.mjs',
    'menu-helper.py',
    'run.mjs',
  ])
    copy(path.join(framework, 'hosts/desktop', file), path.join(work, file));
  write(
    path.join(work, 'scene.ts'),
    `import {createInputScope} from '@solid-multiplatform/platform/input';
import { setDefaultPlatform } from '@solid-multiplatform/renderer/platform';
import { getRenderer } from '@solid-multiplatform/platform';
import { updateViewport, zeroInsets } from '@solid-multiplatform/platform/viewport';
import { attachPlugins } from '@solid-multiplatform/platform/plugins';
import { mount } from './src/app';
import { plugins } from './plugins.mjs';
export function install(adapter) { setDefaultPlatform(class {constructor(){return adapter;}}); }
export function repaint(){getRenderer()?.requestRender();}
export function resize({width,height,scale}){updateViewport({width,height,scale,safeArea:zeroInsets,keyboardInset:0,reducedMotion:false});}
export function start(host){
  const input=createInputScope();host.input=input;
  const abort=new AbortController();
  for(const type of ['pointerdown','pointermove','pointerup','wheel','blur']){
    host.events.addEventListener(type,e=>{
      const p={x:e.clientX,y:e.clientY};
      if(type==='blur')input.cancelAll();
      else if(type==='pointerdown' && e.button===0)input.down(1,p);
      else if(type==='pointerup' && e.button===0)input.up(1,p);
      else if(type==='pointermove')input.move(1,p);
      else if(type==='wheel')input.wheel(p,e.deltaX*16,e.deltaY*16);
    },{signal:abort.signal});
  }
  const detach=attachPlugins(plugins,host);
  try {
    const dispose=mount(plugins,new URL('./fonts',import.meta.url).href,input,host);
    return ()=>{try {dispose?.();getRenderer()?.destroy();} finally {abort.abort();input.dispose();detach();}};
  }catch(error){detach();throw error;}
}
`,
  );
  command(
    process.execPath,
    [path.join(framework, 'hosts/desktop/bundle.mjs'), dir],
    dir,
  );
  if (launch) command(process.execPath, [path.join(work, 'run.mjs')], dir);
}
