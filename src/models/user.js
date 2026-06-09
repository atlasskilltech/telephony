'use strict';

const { DataTypes, Model } = require('sequelize');
const bcrypt = require('bcryptjs');
const config = require('../config');

module.exports = (sequelize) => {
  class User extends Model {
    static associate(models) {
      User.belongsTo(models.Role, { foreignKey: 'role_id', as: 'role' });
      User.belongsTo(User, { foreignKey: 'team_leader_id', as: 'teamLeader' });
      User.hasMany(User, { foreignKey: 'team_leader_id', as: 'teamMembers' });
      User.belongsToMany(models.Permission, {
        through: models.UserPermission,
        foreignKey: 'user_id',
        otherKey: 'permission_id',
        as: 'permissions',
      });
      User.hasMany(models.Lead, { foreignKey: 'assigned_to', as: 'assignedLeads' });
      User.hasMany(models.CallLog, { foreignKey: 'agent_id', as: 'calls' });
      User.hasMany(models.Followup, { foreignKey: 'user_id', as: 'followups' });
      User.hasMany(models.RefreshToken, { foreignKey: 'user_id', as: 'refreshTokens' });
    }

    async validatePassword(plain) {
      return bcrypt.compare(plain, this.password);
    }

    toJSON() {
      const values = { ...this.get() };
      delete values.password;
      delete values.reset_token;
      delete values.reset_token_expires;
      return values;
    }
  }

  User.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      uuid: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, unique: true },
      name: { type: DataTypes.STRING(150), allowNull: false },
      email: {
        type: DataTypes.STRING(190),
        allowNull: false,
        unique: true,
        validate: { isEmail: true },
      },
      phone: { type: DataTypes.STRING(20), allowNull: true },
      password: { type: DataTypes.STRING(255), allowNull: false },
      role_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      team_leader_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      // Telephony agent extension/SIP id for click-to-call dialling.
      agent_extension: { type: DataTypes.STRING(40), allowNull: true },
      avatar_url: { type: DataTypes.STRING(255), allowNull: true },
      // Free-form JSON for per-user settings, e.g. assignment specialisations
      // { courses: [...], cities: [...] } used by AssignmentService.
      meta: { type: DataTypes.JSON, allowNull: true },
      status: { type: DataTypes.ENUM('active', 'inactive', 'suspended'), defaultValue: 'active' },
      last_login_at: { type: DataTypes.DATE, allowNull: true },
      reset_token: { type: DataTypes.STRING(255), allowNull: true },
      reset_token_expires: { type: DataTypes.DATE, allowNull: true },
      created_by: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    },
    {
      sequelize,
      modelName: 'User',
      tableName: 'users',
      indexes: [
        { fields: ['role_id'] },
        { fields: ['team_leader_id'] },
        { fields: ['status'] },
      ],
      hooks: {
        beforeSave: async (user) => {
          if (user.changed('password')) {
            user.password = await bcrypt.hash(user.password, config.jwt.bcryptRounds);
          }
        },
      },
    }
  );

  return User;
};
