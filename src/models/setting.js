'use strict';

const { DataTypes, Model } = require('sequelize');

/**
 * User-scoped preferences (theme, notification toggles). When user_id is
 * NULL the row is a global default.
 */
module.exports = (sequelize) => {
  class Setting extends Model {
    static associate(models) {
      Setting.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    }
  }

  Setting.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      key: { type: DataTypes.STRING(120), allowNull: false },
      value: { type: DataTypes.JSON, allowNull: true },
    },
    {
      sequelize,
      modelName: 'Setting',
      tableName: 'settings',
      paranoid: false,
      indexes: [{ unique: true, fields: ['user_id', 'key'] }],
    }
  );

  return Setting;
};
