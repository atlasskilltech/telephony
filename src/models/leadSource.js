'use strict';

const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class LeadSource extends Model {
    static associate(models) {
      LeadSource.hasMany(models.Lead, { foreignKey: 'source_id', as: 'leads' });
    }
  }

  LeadSource.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      name: { type: DataTypes.STRING(100), allowNull: false },
      slug: { type: DataTypes.STRING(80), allowNull: false, unique: true },
      // excel | csv | api | website | facebook | manual | walk_in
      channel: { type: DataTypes.STRING(40), allowNull: true },
      is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
    },
    { sequelize, modelName: 'LeadSource', tableName: 'telephony_lead_sources' }
  );

  return LeadSource;
};
