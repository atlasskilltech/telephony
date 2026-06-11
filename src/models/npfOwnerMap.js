'use strict';

const { DataTypes, Model } = require('sequelize');

/**
 * Reference mapping of a counselor name to their NoPaperForms (NPF) owner id
 * ("Level 2 ID"). Seeded from the admission team's Level-2 export and used to
 * resolve a user's `npf_owner_id` when an account matching the name exists.
 */
module.exports = (sequelize) => {
  class NpfOwnerMap extends Model {}

  NpfOwnerMap.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      owner_id: { type: DataTypes.STRING(60), allowNull: false },
      name: { type: DataTypes.STRING(190), allowNull: false },
      // Lower-cased, whitespace-collapsed name used for matching.
      name_key: { type: DataTypes.STRING(190), allowNull: false },
      source: { type: DataTypes.STRING(60), allowNull: true },
    },
    {
      sequelize,
      modelName: 'NpfOwnerMap',
      tableName: 'npf_owner_map',
      indexes: [{ fields: ['owner_id'], unique: true }, { fields: ['name_key'] }],
    }
  );

  return NpfOwnerMap;
};
