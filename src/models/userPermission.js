'use strict';

const { DataTypes, Model } = require('sequelize');

/**
 * Per-user permission overrides on top of role-derived permissions.
 * `effect` allows explicitly granting or revoking a single permission.
 */
module.exports = (sequelize) => {
  class UserPermission extends Model {}

  UserPermission.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      permission_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      effect: { type: DataTypes.ENUM('allow', 'deny'), defaultValue: 'allow' },
    },
    {
      sequelize,
      modelName: 'UserPermission',
      tableName: 'user_permissions',
      paranoid: false,
      indexes: [{ unique: true, fields: ['user_id', 'permission_id'] }],
    }
  );

  return UserPermission;
};
