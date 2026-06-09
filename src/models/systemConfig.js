'use strict';

const { DataTypes, Model } = require('sequelize');

/**
 * Global, application-wide configuration editable by Super Admin
 * (telephony provider keys, assignment strategy, AI toggles, etc.).
 */
module.exports = (sequelize) => {
  class SystemConfig extends Model {}

  SystemConfig.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      key: { type: DataTypes.STRING(120), allowNull: false, unique: true },
      value: { type: DataTypes.JSON, allowNull: true },
      group: { type: DataTypes.STRING(60), allowNull: true },
      description: { type: DataTypes.STRING(255), allowNull: true },
      is_secret: { type: DataTypes.BOOLEAN, defaultValue: false },
    },
    {
      sequelize,
      modelName: 'SystemConfig',
      tableName: 'system_configs',
      paranoid: false,
    }
  );

  return SystemConfig;
};
