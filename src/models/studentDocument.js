'use strict';

const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class StudentDocument extends Model {
    static associate(models) {
      StudentDocument.belongsTo(models.Student, { foreignKey: 'student_id', as: 'student' });
      StudentDocument.belongsTo(models.User, { foreignKey: 'uploaded_by', as: 'uploader' });
    }
  }

  StudentDocument.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      student_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      // marksheet | id_proof | photo | application_form | other
      type: { type: DataTypes.STRING(60), allowNull: false },
      file_name: { type: DataTypes.STRING(255), allowNull: false },
      file_url: { type: DataTypes.STRING(512), allowNull: false },
      storage_driver: { type: DataTypes.ENUM('local', 's3'), defaultValue: 'local' },
      mime_type: { type: DataTypes.STRING(120), allowNull: true },
      size_bytes: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      uploaded_by: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    },
    {
      sequelize,
      modelName: 'StudentDocument',
      tableName: 'telephony_student_documents',
      indexes: [{ fields: ['student_id'] }],
    }
  );

  return StudentDocument;
};
