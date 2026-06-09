'use strict';

const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class WhatsappLog extends Model {
    static associate(models) {
      WhatsappLog.belongsTo(models.Lead, { foreignKey: 'lead_id', as: 'lead' });
    }
  }

  WhatsappLog.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      lead_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      to_number: { type: DataTypes.STRING(20), allowNull: false },
      template: { type: DataTypes.STRING(120), allowNull: true },
      // new_lead | brochure | fee_inquiry | followup_reminder | admission_confirmation
      trigger: { type: DataTypes.STRING(60), allowNull: true },
      payload: { type: DataTypes.JSON, allowNull: true },
      provider_message_id: { type: DataTypes.STRING(120), allowNull: true },
      status: {
        type: DataTypes.ENUM('queued', 'sent', 'delivered', 'read', 'failed'),
        defaultValue: 'queued',
      },
      error: { type: DataTypes.STRING(512), allowNull: true },
    },
    {
      sequelize,
      modelName: 'WhatsappLog',
      tableName: 'telephony_whatsapp_logs',
      paranoid: false,
      indexes: [{ fields: ['lead_id'] }, { fields: ['status'] }],
    }
  );

  return WhatsappLog;
};
