'use strict';

const { withPrefix } = require('../config/tablePrefix');

/**
 * Adds richer fields to call_analysis used by the single-call analysis report:
 * positive/negative call points, a recommendations list and a sentiment arc
 * (series of -1..1 values across the call). Idempotent.
 */
const COLUMNS = ['positive_points', 'negative_points', 'recommendations', 'sentiment_arc'];

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = withPrefix('call_analysis');
    const desc = await queryInterface.describeTable(table);
    for (const col of COLUMNS) {
      if (!desc[col]) {
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.addColumn(table, col, { type: Sequelize.JSON, allowNull: true });
      }
    }
  },

  async down(queryInterface) {
    const table = withPrefix('call_analysis');
    const desc = await queryInterface.describeTable(table);
    for (const col of COLUMNS) {
      if (desc[col]) {
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.removeColumn(table, col);
      }
    }
  },
};
