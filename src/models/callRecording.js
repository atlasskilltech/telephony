'use strict';

const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class CallRecording extends Model {
    static associate(models) {
      CallRecording.belongsTo(models.CallLog, { foreignKey: 'call_id', as: 'call' });
    }
  }

  CallRecording.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      call_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      // Original provider URL plus the storage key once archived to S3/local.
      source_url: { type: DataTypes.STRING(512), allowNull: true },
      storage_driver: { type: DataTypes.ENUM('local', 's3'), defaultValue: 'local' },
      storage_key: { type: DataTypes.STRING(512), allowNull: true },
      file_size_bytes: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      duration_seconds: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      format: { type: DataTypes.STRING(20), defaultValue: 'mp3' },
      status: {
        type: DataTypes.ENUM('pending', 'archived', 'failed'),
        defaultValue: 'pending',
      },
      archived_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: 'CallRecording',
      tableName: 'call_recordings',
      indexes: [{ fields: ['call_id'] }, { fields: ['status'] }],
    }
  );

  return CallRecording;
};
