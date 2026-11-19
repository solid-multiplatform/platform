// @ts-check
// The target registry. Commands look targets up here; nothing else in the
// CLI branches on a target name to decide what a target can do.
import web from './web.mjs';
import tizen from './tizen.mjs';
import webos from './webos.mjs';
import vizio from './vizio.mjs';
import ps4 from './ps4.mjs';
import roku from './roku.mjs';
import android from './android.mjs';
import androidTV from './android-tv.mjs';
import ios from './ios.mjs';
import appleTV from './apple-tv.mjs';
import desktop from './desktop.mjs';

/** @type {readonly import('../types.d.ts').TargetDefinition[]} */
export const targets = Object.freeze([
  web,
  tizen,
  webos,
  vizio,
  ps4,
  roku,
  android,
  androidTV,
  ios,
  appleTV,
  desktop,
]);

export const targetNames = targets.map((target) => target.name);

/**
 * @param {string} name
 * @returns {import('../types.d.ts').TargetDefinition | undefined}
 */
export const findTarget = (name) =>
  targets.find((target) => target.name === name);
