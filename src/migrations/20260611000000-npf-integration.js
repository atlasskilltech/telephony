'use strict';

const { withPrefix } = require('../config/tablePrefix');

/**
 * NoPaperForms (NPF) integration schema.
 *
 *  1. Adds `users.npf_owner_id` — the counselor's NPF "Level 2 ID" (owner id),
 *     used as `activity_assign` when pushing the post-call Dynamic Activity.
 *  2. Creates `npf_owner_map` — a standalone reference table mapping a
 *     counselor name to their NPF owner id (seeded from the Level-2 export).
 *     A user only receives an owner id when a real account matching the
 *     mapped name/email exists, so the mapping is kept separate from `users`.
 *
 * Idempotent: guards every change with describeTable / showAllTables so it is
 * safe to re-run on partially-migrated databases.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { BIGINT, STRING, DATE } = Sequelize;

    // ---- 1. users.npf_owner_id ----
    const usersTable = withPrefix('users');
    const usersDesc = await queryInterface.describeTable(usersTable);
    if (!usersDesc.npf_owner_id) {
      await queryInterface.addColumn(usersTable, 'npf_owner_id', {
        type: STRING(60),
        allowNull: true,
        after: 'agent_extension',
      });
    }

    // ---- 2. npf_owner_map ----
    const mapTable = withPrefix('npf_owner_map');
    const tables = await queryInterface.showAllTables();
    const exists = tables
      .map((t) => (typeof t === 'string' ? t : t.tableName))
      .includes(mapTable);
    if (!exists) {
      await queryInterface.createTable(mapTable, {
        id: { type: BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
        // NPF owner id (Level 2 ID), e.g. "1515833".
        owner_id: { type: STRING(60), allowNull: false },
        // Original display name from the NPF export (Level 2 Value).
        name: { type: STRING(190), allowNull: false },
        // Lower-cased, whitespace-collapsed name used for matching users.
        name_key: { type: STRING(190), allowNull: false },
        source: { type: STRING(60), allowNull: true },
        created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updated_at: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        deleted_at: { type: DATE, allowNull: true },
      });
      await queryInterface.addIndex(mapTable, ['owner_id'], {
        unique: true,
        name: 'npf_owner_map_owner_id_uq',
      });
      await queryInterface.addIndex(mapTable, ['name_key'], {
        name: 'npf_owner_map_name_key_idx',
      });
    }
  },

  async down(queryInterface) {
    const usersTable = withPrefix('users');
    const usersDesc = await queryInterface.describeTable(usersTable);
    if (usersDesc.npf_owner_id) {
      await queryInterface.removeColumn(usersTable, 'npf_owner_id');
    }
    await queryInterface.dropTable(withPrefix('npf_owner_map'));
  },
};
