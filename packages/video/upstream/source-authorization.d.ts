import { type PlaybackAuthorization } from './types';
/** Validate source-only credentials before handing them to a platform engine. */
export declare function checkedSourceAuthorization(input?: PlaybackAuthorization): PlaybackAuthorization | undefined;
export declare function hasSourceAuthorization(input?: PlaybackAuthorization): boolean;
