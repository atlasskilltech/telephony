'use strict';

const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Admission extends Model {
    static associate(models) {
      Admission.belongsTo(models.Application, { foreignKey: 'application_id', as: 'application' });
      Admission.belongsTo(models.Student, { foreignKey: 'student_id', as: 'student' });
      Admission.belongsTo(models.User, { foreignKey: 'counselor_id', as: 'counselor' });
    }
  }

  Admission.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      admission_no: { type: DataTypes.STRING(40), allowNull: false, unique: true },
      application_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      student_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      counselor_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      course: { type: DataTypes.STRING(150), allowNull: false },
      intake: { type: DataTypes.STRING(60), allowNull: true },
      status: {
        type: DataTypes.ENUM('confirmed', 'enrolled', 'cancelled'),
        defaultValue: 'confirmed',
      },
      fee_paid: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      confirmed_at: { type: DataTypes.DATE, allowNull: true },
      enrolled_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: 'Admission',
      tableName: 'telephony_admissions',
      indexes: [{ fields: ['counselor_id'] }, { fields: ['status'] }, { fields: ['student_id'] }],
    }
  );

  return Admission;
};
