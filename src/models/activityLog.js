'use strict';

const { DataTypes, Model } = require('sequelize');

/**
 * Human-readable timeline events (lead notes, status changes, calls)
 * rendered on the lead timeline view.
 */
module.exports = (sequelize) => {
  class ActivityLog extends Model {
    static associate(models) {
      ActivityLog.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    }
  }

  ActivityLog.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      subject_type: { type: DataTypes.STRING(60), allowNull: false }, // lead | call | followup
      subject_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      action: { type: DataTypes.STRING(80), allowNull: false },
      description: { type: DataTypes.STRING(512), allowNull: true },
      properties: { type: DataTypes.JSON, allowNull: true },
    },
    {
      sequelize,
      modelName: 'ActivityLog',
      tableName: 'activity_logs',
      paranoid: false,
      indexes: [{ fields: ['subject_type', 'subject_id'] }, { fields: ['user_id'] }],
    }
  );

  return ActivityLog;
};
