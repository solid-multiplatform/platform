// The fixture, exiting as soon as its first frame has been presented:
// measure.mjs times the whole process, from spawn to exit.
import { startDesktop } from '@solid-multiplatform/host-desktop';
import { mountFixture } from '../scene/app';

startDesktop(() => mountFixture('fonts'));
requestAnimationFrame(() => setTimeout(() => __solid.exit(0), 0));
