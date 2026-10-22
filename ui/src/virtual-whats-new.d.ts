// The release notes the build reads (#417, vite.config.ts): every release of
// both packages it keeps, and the versions this build runs on. A module that
// exists only on paper, which is to say a fully compliant one.
declare module 'virtual:whats-new' {
  import type { Release, Versions } from './whats-new.ts';
  export const releases: Release[];
  export const current: Versions;
}
