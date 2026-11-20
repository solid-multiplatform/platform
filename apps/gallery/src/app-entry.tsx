/**
 * The native targets' entry component. The CLI scaffolds `src/app.tsx` as the
 * app; the build script writes that file to re-export this one (the repo keeps
 * no `app.tsx` beside `App.tsx`: the two names would collide on a
 * case-insensitive filesystem).
 */
export { App } from './App';
