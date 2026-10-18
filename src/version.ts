export const VERSION: string = typeof __TOIL_VERSION__ === 'string' ? __TOIL_VERSION__ : '0.0.0-dev';

/**
 * The commit the bundle was built from: 40 hex characters, or null when this
 * isn't a bundle (tests, a source run) or the build had no git to ask. The
 * feedback endpoint for terminals asks for it, so a report names a real build.
 */
export const COMMIT: string | null =
  typeof __TOIL_COMMIT__ === 'string' && /^[0-9a-f]{40}$/.test(__TOIL_COMMIT__) ? __TOIL_COMMIT__ : null;
