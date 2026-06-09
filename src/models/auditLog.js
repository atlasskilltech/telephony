'use strict';

const { DataTypes, Model } = require('sequelize');

/**
 * Security-grade, append-only audit trail (who did what, from where).
 * Distinct from activity_logs which is user-facing; this is compliance-facing.
 */
module.exports = (sequelize) => {
  class AuditLog extends Model {}

  AuditLog.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      action: { type: DataTypes.STRING(120), allowNull: false }, // user.login, lead.update ...
      entity: { type: DataTypes.STRING(60), allowNull: true },
      entity_id: { type: DataTypes.STRING(60), allowNull: true },
      ip_address: { type: DataTypes.STRING(64), allowNull: true },
      user_agent: { type: DataTypes.STRING(255), allowNull: true },
      method: { type: DataTypes.STRING(10), allowNull: true },
      path: { type: DataTypes.STRING(255), allowNull: true },
      status_code: { type: DataTypes.INTEGER, allowNull: true },
      changes: { type: DataTypes.JSON, allowNull: true },
    },
    {
      sequelize,
      modelName: 'AuditLog',
      tableName: 'audit_logs',
      paranoid: false,
      updatedAt: false,
      indexes: [{ fields: ['user_id'] }, { fields: ['action'] }, { fields: ['entity', 'entity_id'] }],
    }
  );

  return AuditLog;
};
