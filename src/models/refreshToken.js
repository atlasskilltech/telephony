'use strict';

const { DataTypes, Model } = require('sequelize');

/**
 * Persisted refresh tokens enable session management, device tracking
 * and server-side revocation (logout from one / all devices).
 */
module.exports = (sequelize) => {
  class RefreshToken extends Model {
    static associate(models) {
      RefreshToken.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    }
  }

  RefreshToken.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      // SHA-256 hash of the issued refresh token (never store the raw token).
      token_hash: { type: DataTypes.STRING(255), allowNull: false },
      device_name: { type: DataTypes.STRING(150), allowNull: true },
      device_id: { type: DataTypes.STRING(150), allowNull: true },
      ip_address: { type: DataTypes.STRING(64), allowNull: true },
      user_agent: { type: DataTypes.STRING(255), allowNull: true },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      revoked_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: 'RefreshToken',
      tableName: 'refresh_tokens',
      paranoid: false,
      indexes: [{ fields: ['user_id'] }, { fields: ['token_hash'] }],
    }
  );

  return RefreshToken;
};
