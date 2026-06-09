'use strict';

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../config/database');

const db = {};
const basename = path.basename(__filename);

// Auto-load every model definition in this directory.
fs.readdirSync(__dirname)
  .filter(
    (file) =>
      file.indexOf('.') !== 0 &&
      file !== basename &&
      file.slice(-3) === '.js' &&
      !file.endsWith('.test.js')
  )
  .forEach((file) => {
    const defineModel = require(path.join(__dirname, file));
    const model = defineModel(sequelize);
    db[model.name] = model;
  });

// Wire up associations once every model is registered.
Object.keys(db).forEach((name) => {
  if (typeof db[name].associate === 'function') {
    db[name].associate(db);
  }
});

db.sequelize = sequelize;

module.exports = db;
