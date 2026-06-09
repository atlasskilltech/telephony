'use strict';

const { withPrefix } = require('../config/tablePrefix');

/**
 * Adds the `meta` JSON column to `users`.
 *
 * AssignmentService reads `user.meta.courses` / `user.meta.cities` for the
 * course-wise and city-wise strategies, but the column was missing from
 * databases provisioned by the original init migration, causing
 * "Unknown column 'meta' in 'SELECT'" on lead assignment.
 *
 * Idempotent: the init migration now also creates this column, so on a
 * fresh database the column may already exist — guard with describeTable.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = withPrefix('users');
    const desc = await queryInterface.describeTable(table);
    if (!desc.meta) {
      await queryInterface.addColumn(table, 'meta', {
        type: Sequelize.JSON,
        allowNull: true,
        after: 'avatar_url',
      });
    }
  },

  async down(queryInterface) {
    const table = withPrefix('users');
    const desc = await queryInterface.describeTable(table);
    if (desc.meta) {
      await queryInterface.removeColumn(table, 'meta');
    }
  },
};
