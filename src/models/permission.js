'use strict';

const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Permission extends Model {
    static associate(models) {
      Permission.belongsToMany(models.Role, {
        through: 'role_permissions',
        foreignKey: 'permission_id',
        otherKey: 'role_id',
        as: 'roles',
      });
      Permission.belongsToMany(models.User, {
        through: models.UserPermission,
        foreignKey: 'permission_id',
        otherKey: 'user_id',
        as: 'users',
      });
    }
  }

  Permission.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      name: { type: DataTypes.STRING(120), allowNull: false },
      // e.g. "leads.create", "calls.view", "reports.export"
      slug: { type: DataTypes.STRING(120), allowNull: false, unique: true },
      module: { type: DataTypes.STRING(60), allowNull: true },
      description: { type: DataTypes.STRING(255), allowNull: true },
    },
    { sequelize, modelName: 'Permission', tableName: 'permissions' }
  );

  return Permission;
};
