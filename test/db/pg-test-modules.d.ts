// pg's connection settings resolver, imported by path so a test can check what
// pg would read from the environment. Untyped upstream; typed here, in triplicate.
declare module 'pg/lib/connection-parameters.js' {
  export default class ConnectionParameters {
    constructor(config: unknown);
  }
}
