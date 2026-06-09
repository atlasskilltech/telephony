'use strict';

const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Lead extends Model {
    static associate(models) {
      Lead.belongsTo(models.Student, { foreignKey: 'student_id', as: 'student' });
      Lead.belongsTo(models.LeadSource, { foreignKey: 'source_id', as: 'source' });
      Lead.belongsTo(models.LeadStatus, { foreignKey: 'status_id', as: 'status' });
      Lead.belongsTo(models.User, { foreignKey: 'assigned_to', as: 'counselor' });
      Lead.hasMany(models.LeadAssignment, { foreignKey: 'lead_id', as: 'assignments' });
      Lead.hasMany(models.Followup, { foreignKey: 'lead_id', as: 'followups' });
      Lead.hasMany(models.CallLog, { foreignKey: 'lead_id', as: 'calls' });
      Lead.hasMany(models.Application, { foreignKey: 'lead_id', as: 'applications' });
    }
  }

  Lead.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      uuid: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, unique: true },
      reference_no: { type: DataTypes.STRING(40), allowNull: true, unique: true },
      student_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      source_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      status_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      assigned_to: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      pipeline_stage: { type: DataTypes.STRING(60), defaultValue: 'new_lead' },
      course: { type: DataTypes.STRING(150), allowNull: true },
      intake: { type: DataTypes.STRING(60), allowNull: true },
      city: { type: DataTypes.STRING(100), allowNull: true },
      // 0-100 priority/lead score; AI analysis can update this.
      score: { type: DataTypes.INTEGER, defaultValue: 0 },
      priority: { type: DataTypes.ENUM('low', 'medium', 'high', 'hot'), defaultValue: 'medium' },
      // AI-derived signals surfaced on the list view.
      ai_interest_score: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
      ai_admission_probability: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
      last_contacted_at: { type: DataTypes.DATE, allowNull: true },
      next_followup_at: { type: DataTypes.DATE, allowNull: true },
      is_duplicate: { type: DataTypes.BOOLEAN, defaultValue: false },
      merged_into_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      tags: { type: DataTypes.JSON, allowNull: true },
      meta: { type: DataTypes.JSON, allowNull: true },
      created_by: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    },
    {
      sequelize,
      modelName: 'Lead',
      tableName: 'leads',
      indexes: [
        { fields: ['assigned_to'] },
        { fields: ['status_id'] },
        { fields: ['source_id'] },
        { fields: ['pipeline_stage'] },
        { fields: ['next_followup_at'] },
        // Composite index for the most common counselor dashboard query.
        { fields: ['assigned_to', 'pipeline_stage'] },
        { fields: ['course', 'city'] },
      ],
    }
  );

  return Lead;
};
