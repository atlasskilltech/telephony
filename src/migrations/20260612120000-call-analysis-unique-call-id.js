'use strict';

const { withPrefix } = require('../config/tablePrefix');

/**
 * Guarantee exactly one AI report per call: make `call_analysis.call_id`
 * UNIQUE. The hasOne association + findOrCreate already enforce this in app
 * code, but without a DB constraint two concurrent analysis workers could race
 * and write two report rows for the same call. This adds the missing guard.
 *
 * Steps (idempotent):
 *   1. Delete duplicate rows, keeping the most recent (highest id) per call_id,
 *      so the unique index can be created on existing data.
 *   2. Drop the redundant non-unique call_id index if present.
 *   3. Add the unique index `call_analysis_call_id_uq`.
 */
const UNIQUE_NAME = 'call_analysis_call_id_uq';

// Columns covered by an index, across dialect-specific shapes.
const indexColumns = (idx) =>
  (idx.fields || []).map((f) => f.attribute || f.columnName || f.column_name || f);
const isCallIdIndex = (idx) => {
  const cols = indexColumns(idx);
  return cols.length === 1 && cols[0] === 'call_id';
};

module.exports = {
  async up(queryInterface) {
    const table = withPrefix('call_analysis');

    // 1. Remove duplicate analysis rows, keeping the newest per call.
    await queryInterface.sequelize.query(
      `DELETE t1 FROM \`${table}\` t1
       JOIN \`${table}\` t2
         ON t1.call_id = t2.call_id AND t1.id < t2.id`
    );

    const indexes = await queryInterface.showIndex(table);
    if (indexes.some((i) => isCallIdIndex(i) && i.unique)) return; // already unique

    // 2. Drop the existing non-unique call_id index (if any) so we don't keep
    //    two indexes on the same column.
    const nonUnique = indexes.find((i) => isCallIdIndex(i) && !i.unique);
    if (nonUnique) await queryInterface.removeIndex(table, nonUnique.name);

    // 3. Add the unique index.
    await queryInterface.addIndex(table, ['call_id'], { unique: true, name: UNIQUE_NAME });
  },

  async down(queryInterface) {
    const table = withPrefix('call_analysis');
    const indexes = await queryInterface.showIndex(table);
    if (indexes.some((i) => i.name === UNIQUE_NAME)) {
      await queryInterface.removeIndex(table, UNIQUE_NAME);
    }
    // Restore the original non-unique index if it is no longer present.
    if (!indexes.some((i) => isCallIdIndex(i) && !i.unique)) {
      await queryInterface.addIndex(table, ['call_id'], { name: 'call_analysis_call_id' });
    }
  },
};
