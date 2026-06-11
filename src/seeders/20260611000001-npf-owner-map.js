'use strict';

const { withPrefix } = require('../config/tablePrefix');

/**
 * Seeds the NPF owner mapping (counselor name -> NoPaperForms "Level 2 ID")
 * from the admission team's Level-2 export. The owner id becomes the
 * `activity_assign` value on the post-call Dynamic Activity, and is attached
 * to a user account when a matching real user is created/updated.
 *
 * Idempotent: only inserts owner ids that are not already present, so it can
 * be re-run safely after the team list changes.
 */

// name_key normalisation must match UserService._normalizeName.
const nameKey = (name) =>
  String(name || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const ROWS = [
  ['1515821', 'Ritesh Acharekar'],
  ['1515822', 'Yogita'],
  ['1515823', 'Vipul Raghuvanshi'],
  ['1515824', 'Nayana Jadhav'],
  ['1515825', 'Mayur'],
  ['1515826', 'Amreen Wadkar'],
  ['1515827', 'Alisha Ansari'],
  ['1515828', 'PRIYA LONDHE'],
  ['1515829', 'ATLAS SkillTech University'],
  ['1515830', 'Bhavesh Kalani'],
  ['1515831', 'Vidhya Pandya'],
  ['1515832', 'Alipriya Sen'],
  ['1515833', 'Shivani Patil'],
  ['1515834', 'Omkar Kadam'],
  ['1515835', 'Rashmi Sawant'],
  ['1515836', 'Afreen Sayed'],
  ['1515837', 'Harpreet Kaur'],
  ['1515838', 'Priya Jana'],
  ['1515839', 'Mahesh Pal'],
  ['1515840', 'Hussain Shaikh'],
  ['1515841', 'Parth Sanghvi'],
  ['1515842', 'Ms Jita Rajendran'],
  ['1515843', 'Bhushan soni'],
  ['1516044', 'Urvashi'],
];

module.exports = {
  async up(queryInterface) {
    const table = withPrefix('npf_owner_map');
    const now = new Date();

    const existing = await queryInterface.sequelize.query(
      `SELECT owner_id FROM ${table}`,
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    );
    const have = new Set(existing.map((r) => String(r.owner_id)));

    const rows = ROWS.filter(([ownerId]) => !have.has(String(ownerId))).map(
      ([ownerId, name]) => ({
        owner_id: String(ownerId),
        name,
        name_key: nameKey(name),
        source: 'level2_export',
        created_at: now,
        updated_at: now,
      })
    );

    if (rows.length) await queryInterface.bulkInsert(table, rows);
  },

  async down(queryInterface) {
    const table = withPrefix('npf_owner_map');
    const { Op } = require('sequelize');
    await queryInterface.bulkDelete(table, {
      owner_id: { [Op.in]: ROWS.map(([ownerId]) => String(ownerId)) },
    });
  },
};
