'use strict';

const { DataTypes, Model } = require('sequelize');

/**
 * Immutable audit trail of every lead -> counselor assignment, including
 * which strategy produced it (round robin, manual, etc.).
 */
module.exports = (sequelize) => {
  class LeadAssignment extends Model {
    static associate(models) {
      LeadAssignment.belongsTo(models.Lead, { foreignKey: 'lead_id', as: 'lead' });
      LeadAssignment.belongsTo(models.User, { foreignKey: 'assigned_to', as: 'counselor' });
      LeadAssignment.belongsTo(models.User, { foreignKey: 'assigned_by', as: 'assigner' });
    }
  }

  LeadAssignment.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      lead_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      assigned_to: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      assigned_by: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      strategy: { type: DataTypes.STRING(40), defaultValue: 'manual' },
      note: { type: DataTypes.STRING(255), allowNull: true },
      is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
    },
    {
      sequelize,
      modelName: 'LeadAssignment',
      tableName: 'telephony_lead_assignments',
      indexes: [{ fields: ['lead_id'] }, { fields: ['assigned_to'] }],
    }
  );

  return LeadAssignment;
};
