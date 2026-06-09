'use strict';

const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Notification extends Model {
    static associate(models) {
      Notification.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    }
  }

  Notification.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      // new_lead | missed_call | followup_due | admission_converted | system
      type: { type: DataTypes.STRING(60), allowNull: false },
      title: { type: DataTypes.STRING(180), allowNull: false },
      body: { type: DataTypes.STRING(512), allowNull: true },
      data: { type: DataTypes.JSON, allowNull: true },
      read_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: 'Notification',
      tableName: 'telephony_notifications',
      paranoid: false,
      indexes: [{ fields: ['user_id', 'read_at'] }, { fields: ['type'] }],
    }
  );

  return Notification;
};
