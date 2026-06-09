'use strict';

const { DataTypes, Model } = require('sequelize');

/**
 * The person behind a lead. A student can, over time, have multiple leads
 * (e.g. enquiries for different courses / intakes).
 */
module.exports = (sequelize) => {
  class Student extends Model {
    static associate(models) {
      Student.hasMany(models.Lead, { foreignKey: 'student_id', as: 'leads' });
      Student.hasMany(models.StudentDocument, { foreignKey: 'student_id', as: 'documents' });
      Student.hasMany(models.Application, { foreignKey: 'student_id', as: 'applications' });
    }
  }

  Student.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      uuid: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, unique: true },
      first_name: { type: DataTypes.STRING(100), allowNull: false },
      last_name: { type: DataTypes.STRING(100), allowNull: true },
      email: { type: DataTypes.STRING(190), allowNull: true },
      phone: { type: DataTypes.STRING(20), allowNull: false },
      alternate_phone: { type: DataTypes.STRING(20), allowNull: true },
      gender: { type: DataTypes.ENUM('male', 'female', 'other'), allowNull: true },
      date_of_birth: { type: DataTypes.DATEONLY, allowNull: true },
      city: { type: DataTypes.STRING(100), allowNull: true },
      state: { type: DataTypes.STRING(100), allowNull: true },
      country: { type: DataTypes.STRING(100), defaultValue: 'India' },
      pincode: { type: DataTypes.STRING(12), allowNull: true },
      qualification: { type: DataTypes.STRING(150), allowNull: true },
      meta: { type: DataTypes.JSON, allowNull: true },
    },
    {
      sequelize,
      modelName: 'Student',
      tableName: 'students',
      indexes: [
        { fields: ['phone'] },
        { fields: ['email'] },
        { fields: ['city'] },
      ],
    }
  );

  return Student;
};
