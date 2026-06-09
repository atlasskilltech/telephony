'use strict';

require('dotenv').config();

/**
 * Single source of truth for the database table-name prefix.
 *
 * Every physical table is namespaced with this prefix (default `telephony_`)
 * so the schema can live safely inside a shared database. It is consumed in
 * three places that must always agree:
 *   - runtime models  (via the `beforeDefine` hook in config/database.js)
 *   - migrations      (src/migrations/*)
 *   - seeders         (src/seeders/*)
 *
 * Override with the DB_TABLE_PREFIX env var. Set it to an empty string to
 * disable prefixing entirely.
 */
const tablePrefix =
  process.env.DB_TABLE_PREFIX === undefined ? 'telephony_' : process.env.DB_TABLE_PREFIX;

/** Prefix a bare table name, e.g. `users` -> `telephony_users`. */
const withPrefix = (name) =>
  tablePrefix && !String(name).startsWith(tablePrefix) ? `${tablePrefix}${name}` : name;

module.exports = { tablePrefix, withPrefix };
