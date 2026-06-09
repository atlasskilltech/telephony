'use strict';

/**
 * Thin generic data-access layer wrapping a Sequelize model. Concrete
 * repositories extend this and add domain-specific queries, keeping
 * services free of ORM details (repository pattern).
 */
class BaseRepository {
  constructor(model) {
    this.model = model;
  }

  create(data, options = {}) {
    return this.model.create(data, options);
  }

  bulkCreate(rows, options = {}) {
    return this.model.bulkCreate(rows, options);
  }

  findById(id, options = {}) {
    return this.model.findByPk(id, options);
  }

  findOne(where, options = {}) {
    return this.model.findOne({ where, ...options });
  }

  findAll(where = {}, options = {}) {
    return this.model.findAll({ where, ...options });
  }

  /**
   * Paginated list returning { rows, count } plus the resolved page/limit.
   */
  async paginate({ where = {}, page = 1, limit = 20, order = [['created_at', 'DESC']], include = [], attributes } = {}) {
    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const { rows, count } = await this.model.findAndCountAll({
      where,
      include,
      attributes,
      order,
      limit: l,
      offset: (p - 1) * l,
      distinct: true,
    });
    return { rows, count, page: p, limit: l };
  }

  async update(id, data, options = {}) {
    const instance = await this.model.findByPk(id);
    if (!instance) return null;
    return instance.update(data, options);
  }

  async destroy(id, options = {}) {
    const instance = await this.model.findByPk(id);
    if (!instance) return false;
    await instance.destroy(options);
    return true;
  }

  count(where = {}) {
    return this.model.count({ where });
  }
}

module.exports = BaseRepository;
