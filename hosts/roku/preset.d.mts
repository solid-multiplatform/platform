import type { RokuConfig } from '@roku-sdk/rsg-ts/roku-config';
export function rokuConfig(options: {
  entry: string;
  assets?: string;
  title: string;
  manifestEntries?: Record<string, string | number>;
}): RokuConfig;
