'use strict';

const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class CallLog extends Model {
    static associate(models) {
      CallLog.belongsTo(models.Lead, { foreignKey: 'lead_id', as: 'lead' });
      CallLog.belongsTo(models.User, { foreignKey: 'agent_id', as: 'agent' });
      CallLog.hasOne(models.CallRecording, { foreignKey: 'call_id', as: 'recording' });
      CallLog.hasOne(models.CallTranscript, { foreignKey: 'call_id', as: 'transcript' });
      CallLog.hasOne(models.CallAnalysis, { foreignKey: 'call_id', as: 'analysis' });
    }
  }

  CallLog.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      uuid: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, unique: true },
      // Provider's unique call identifier (CallSid for Exotel etc.).
      provider: { type: DataTypes.STRING(40), allowNull: true },
      provider_call_id: { type: DataTypes.STRING(120), allowNull: true, unique: true },
      lead_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      agent_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      direction: { type: DataTypes.ENUM('inbound', 'outbound'), defaultValue: 'outbound' },
      from_number: { type: DataTypes.STRING(20), allowNull: true },
      to_number: { type: DataTypes.STRING(20), allowNull: true },
      status: { type: DataTypes.STRING(30), defaultValue: 'initiated' },
      // Seconds of total call and billable conversation time.
      duration_seconds: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
      talk_time_seconds: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
      is_missed: { type: DataTypes.BOOLEAN, defaultValue: false },
      recording_url: { type: DataTypes.STRING(512), allowNull: true },
      started_at: { type: DataTypes.DATE, allowNull: true },
      ended_at: { type: DataTypes.DATE, allowNull: true },
      meta: { type: DataTypes.JSON, allowNull: true },
    },
    {
      sequelize,
      modelName: 'CallLog',
      tableName: 'call_logs',
      indexes: [
        { fields: ['lead_id'] },
        { fields: ['agent_id'] },
        { fields: ['status'] },
        { fields: ['started_at'] },
        { fields: ['agent_id', 'started_at'] },
      ],
    }
  );

  return CallLog;
};
