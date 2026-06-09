'use strict';

const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class EmailLog extends Model {
    static associate(models) {
      EmailLog.belongsTo(models.Lead, { foreignKey: 'lead_id', as: 'lead' });
    }
  }

  EmailLog.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      lead_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      to_email: { type: DataTypes.STRING(190), allowNull: false },
      subject: { type: DataTypes.STRING(255), allowNull: true },
      // welcome | brochure | admission_reminder | offer_letter
      template: { type: DataTypes.STRING(120), allowNull: true },
      provider_message_id: { type: DataTypes.STRING(190), allowNull: true },
      status: {
        type: DataTypes.ENUM('queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed'),
        defaultValue: 'queued',
      },
      opened_at: { type: DataTypes.DATE, allowNull: true },
      clicked_at: { type: DataTypes.DATE, allowNull: true },
      open_count: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
      click_count: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
      error: { type: DataTypes.STRING(512), allowNull: true },
    },
    {
      sequelize,
      modelName: 'EmailLog',
      tableName: 'telephony_email_logs',
      paranoid: false,
      indexes: [{ fields: ['lead_id'] }, { fields: ['status'] }],
    }
  );

  return EmailLog;
};
