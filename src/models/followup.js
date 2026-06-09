'use strict';

const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Followup extends Model {
    static associate(models) {
      Followup.belongsTo(models.Lead, { foreignKey: 'lead_id', as: 'lead' });
      Followup.belongsTo(models.User, { foreignKey: 'user_id', as: 'counselor' });
    }
  }

  Followup.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      lead_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      title: { type: DataTypes.STRING(180), allowNull: false },
      notes: { type: DataTypes.TEXT, allowNull: true },
      // call | whatsapp | email | meeting | visit
      channel: { type: DataTypes.STRING(40), defaultValue: 'call' },
      scheduled_at: { type: DataTypes.DATE, allowNull: false },
      completed_at: { type: DataTypes.DATE, allowNull: true },
      status: {
        type: DataTypes.ENUM('pending', 'completed', 'overdue', 'cancelled'),
        defaultValue: 'pending',
      },
      // Recurrence rule for repeating follow-ups (e.g. "daily", "weekly").
      recurrence: { type: DataTypes.STRING(40), allowNull: true },
      reminder_sent: { type: DataTypes.BOOLEAN, defaultValue: false },
    },
    {
      sequelize,
      modelName: 'Followup',
      tableName: 'telephony_followups',
      indexes: [
        { fields: ['lead_id'] },
        { fields: ['user_id'] },
        { fields: ['status'] },
        { fields: ['scheduled_at'] },
      ],
    }
  );

  return Followup;
};
