'use strict';

const { DataTypes, Model } = require('sequelize');

/**
 * Output of the GPT call-analysis engine plus the QA scorecard.
 */
module.exports = (sequelize) => {
  class CallAnalysis extends Model {
    static associate(models) {
      CallAnalysis.belongsTo(models.CallLog, { foreignKey: 'call_id', as: 'call' });
    }
  }

  CallAnalysis.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      call_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      interest_score: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
      admission_probability: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
      sentiment: { type: DataTypes.ENUM('positive', 'neutral', 'negative'), allowNull: true },
      sentiment_score: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
      risk_score: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
      summary: { type: DataTypes.TEXT, allowNull: true },
      next_action: { type: DataTypes.STRING(255), allowNull: true },
      followup_recommendation: { type: DataTypes.TEXT, allowNull: true },
      objections: { type: DataTypes.JSON, allowNull: true },
      keywords: { type: DataTypes.JSON, allowNull: true },
      intent: { type: DataTypes.STRING(120), allowNull: true },
      // Single-call report fields.
      positive_points: { type: DataTypes.JSON, allowNull: true },
      negative_points: { type: DataTypes.JSON, allowNull: true },
      recommendations: { type: DataTypes.JSON, allowNull: true },
      // Series of -1..1 sentiment values sampled across the call (for the arc).
      sentiment_arc: { type: DataTypes.JSON, allowNull: true },
      // QA scorecard (0-10 each) and aggregate scores.
      qa_scores: { type: DataTypes.JSON, allowNull: true },
      call_quality_score: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
      agent_score: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
      improvement_suggestions: { type: DataTypes.JSON, allowNull: true },
      model: { type: DataTypes.STRING(60), allowNull: true },
      status: {
        type: DataTypes.ENUM('queued', 'processing', 'completed', 'failed'),
        defaultValue: 'queued',
      },
      error: { type: DataTypes.STRING(512), allowNull: true },
    },
    {
      sequelize,
      modelName: 'CallAnalysis',
      tableName: 'call_analysis',
      indexes: [{ fields: ['call_id'] }, { fields: ['sentiment'] }, { fields: ['status'] }],
    }
  );

  return CallAnalysis;
};
