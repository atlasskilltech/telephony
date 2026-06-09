'use strict';

const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class LeadStatus extends Model {
    static associate(models) {
      LeadStatus.hasMany(models.Lead, { foreignKey: 'status_id', as: 'leads' });
    }
  }

  LeadStatus.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      name: { type: DataTypes.STRING(80), allowNull: false },
      slug: { type: DataTypes.STRING(80), allowNull: false, unique: true },
      // Maps a status to a pipeline stage for Kanban grouping.
      pipeline_stage: { type: DataTypes.STRING(60), allowNull: true },
      color: { type: DataTypes.STRING(20), defaultValue: '#6366f1' },
      sort_order: { type: DataTypes.INTEGER, defaultValue: 0 },
      is_won: { type: DataTypes.BOOLEAN, defaultValue: false },
      is_lost: { type: DataTypes.BOOLEAN, defaultValue: false },
    },
    { sequelize, modelName: 'LeadStatus', tableName: 'telephony_lead_statuses' }
  );

  return LeadStatus;
};
