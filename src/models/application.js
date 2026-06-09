'use strict';

const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Application extends Model {
    static associate(models) {
      Application.belongsTo(models.Lead, { foreignKey: 'lead_id', as: 'lead' });
      Application.belongsTo(models.Student, { foreignKey: 'student_id', as: 'student' });
      Application.hasOne(models.Admission, { foreignKey: 'application_id', as: 'admission' });
    }
  }

  Application.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      application_no: { type: DataTypes.STRING(40), allowNull: false, unique: true },
      lead_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      student_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      course: { type: DataTypes.STRING(150), allowNull: false },
      intake: { type: DataTypes.STRING(60), allowNull: true },
      status: {
        type: DataTypes.ENUM('started', 'submitted', 'under_review', 'offer_issued', 'accepted', 'rejected', 'withdrawn'),
        defaultValue: 'started',
      },
      fee_quoted: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      submitted_at: { type: DataTypes.DATE, allowNull: true },
      meta: { type: DataTypes.JSON, allowNull: true },
    },
    {
      sequelize,
      modelName: 'Application',
      tableName: 'applications',
      indexes: [{ fields: ['lead_id'] }, { fields: ['student_id'] }, { fields: ['status'] }],
    }
  );

  return Application;
};
