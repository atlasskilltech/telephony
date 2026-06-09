'use strict';

const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class CallTranscript extends Model {
    static associate(models) {
      CallTranscript.belongsTo(models.CallLog, { foreignKey: 'call_id', as: 'call' });
    }
  }

  CallTranscript.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      call_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      language: { type: DataTypes.STRING(20), allowNull: true },
      // Full plain-text transcript plus a structured, diarised segment array.
      text: { type: DataTypes.TEXT('long'), allowNull: true },
      segments: { type: DataTypes.JSON, allowNull: true },
      speaker_map: { type: DataTypes.JSON, allowNull: true },
      confidence: { type: DataTypes.DECIMAL(5, 4), allowNull: true },
      model: { type: DataTypes.STRING(60), allowNull: true },
      processing_ms: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      status: {
        type: DataTypes.ENUM('queued', 'processing', 'completed', 'failed'),
        defaultValue: 'queued',
      },
      error: { type: DataTypes.STRING(512), allowNull: true },
    },
    {
      sequelize,
      modelName: 'CallTranscript',
      tableName: 'call_transcripts',
      indexes: [{ fields: ['call_id'] }, { fields: ['status'] }],
    }
  );

  return CallTranscript;
};
