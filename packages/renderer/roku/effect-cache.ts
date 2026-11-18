/**
 * The renderer's Effect nodes, shared by their values.
 *
 * An Effect node is never part of the scene tree: a Rectangle or Poster
 * refers to it through its `effect` field, and any number of them may refer
 * to the same node. Roku's SDK warns that making an Effect per change is a
 * silent performance bug, so nodes with equal fields share one, and a holder
 * whose fields change (an animated radius, a colour transition) keeps its
 * node and rewrites the fields that differ. A node nobody holds is kept for
 * the next request, so a steady scene creates none.
 */
import { createElement, setProp } from '@roku-sdk/solid';
import type { NativeEffect } from './effects.js';

export interface EffectEntry {
  node: any;
  key: string;
  /** How many visuals refer to the node. */
  refs: number;
  written: Record<string, any>;
}

const FIELDS = [
  'borderRadius',
  'borderWidth',
  'borderColor',
  'borderPadding',
] as const;
const GRADIENT_FIELDS = [
  'gradientColors',
  'gradientStops',
  'gradientAngle',
  'gradientCentre',
  'gradientRadius',
] as const;

function same(a: any, b: any): boolean {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export class EffectCache {
  private entries = new Map<string, EffectEntry>();
  private spare: EffectEntry[] = [];
  /** Effect nodes created since the renderer started. */
  created = 0;

  /** Effect nodes in use. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * The entry for `effect`, given the one the caller holds (or null). The
   * caller holds the result instead; null means it needs no Effect.
   */
  swap(held: EffectEntry | null, effect: NativeEffect | null): EffectEntry | null {
    if (effect === null) {
      if (held) this.release(held);
      return null;
    }
    if (held && held.key === effect.key) return held;
    const shared = this.entries.get(effect.key);
    if (shared) {
      shared.refs++;
      if (held) this.release(held);
      return shared;
    }
    let entry: EffectEntry;
    if (held && held.refs === 1) {
      // Only the caller refers to it: change it where it is.
      entry = held;
      this.entries.delete(held.key);
    } else {
      if (held) this.release(held);
      entry = this.spare.pop() ?? this.create();
      entry.refs = 1;
    }
    this.write(entry, effect);
    entry.key = effect.key;
    this.entries.set(entry.key, entry);
    return entry;
  }

  release(entry: EffectEntry) {
    if (--entry.refs > 0) return;
    this.entries.delete(entry.key);
    this.spare.push(entry);
  }

  private create(): EffectEntry {
    this.created++;
    return { node: createElement('effect'), key: '', refs: 0, written: {} };
  }

  private write(entry: EffectEntry, effect: NativeEffect) {
    for (const name of FIELDS) this.set(entry, name, effect[name]);
    // Colours and stops go before the style that turns the gradient on, and
    // always as many stops as colours.
    if (effect.gradientStyle !== 'none') {
      for (const name of GRADIENT_FIELDS) this.set(entry, name, effect[name]);
    }
    this.set(entry, 'gradientStyle', effect.gradientStyle);
  }

  private set(entry: EffectEntry, name: string, value: any) {
    if (entry.written[name] !== undefined && same(entry.written[name], value)) return;
    entry.written[name] = Array.isArray(value) ? value.slice() : value;
    setProp(entry.node, name, value);
  }
}
