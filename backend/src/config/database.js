// Pragmas required by the spec. foreign_keys/synchronous/temp_store are per-connection,
// so they must be applied on every open. journal_mode=WAL persists in the file.
// busy_timeout is an addition: it makes concurrent writers wait instead of failing
// immediately with SQLITE_BUSY.
export const PRAGMAS = Object.freeze([
  'journal_mode = WAL',
  'synchronous = NORMAL',
  'foreign_keys = ON',
  'temp_store = MEMORY',
  'busy_timeout = 5000',
]);
