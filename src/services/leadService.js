'use strict';

const { customAlphabet } = require('nanoid');
const { Op } = require('sequelize');
const db = require('../models');
const leadRepository = require('../repositories/leadRepository');
const assignmentService = require('./assignmentService');
const ApiError = require('../utils/ApiError');
const { notificationQueue } = require('../queues');
const { ROLES, NOTIFICATION_EVENTS, ASSIGNMENT_STRATEGIES } = require('../utils/constants');

const refCode = customAlphabet('0123456789ABCDEFGHJKMNPQRSTUVWXYZ', 8);

/**
 * Business logic for leads: creation with student de-duplication, scoped
 * listing, auto-assignment, merging duplicates and timeline notes.
 */
class LeadService {
  /** Restrict the visible lead set based on the requesting user's role. */
  scopeFilters(user, filters = {}) {
    const scoped = { ...filters };
    const role = user.role ? user.role.slug : null;
    if (role === ROLES.COUNSELOR) {
      scoped.assigned_to = user.id; // counselors only see their own leads
    }
    return scoped;
  }

  async list(user, filters, pagination) {
    return leadRepository.list(this.scopeFilters(user, filters), pagination);
  }

  async getById(user, id) {
    const lead = await leadRepository.findFullById(id);
    if (!lead) throw ApiError.notFound('Lead not found');
    if (user.role?.slug === ROLES.COUNSELOR && lead.assigned_to !== user.id) {
      throw ApiError.forbidden('This lead is not assigned to you');
    }
    return lead;
  }

  /**
   * Create a lead. Reuses an existing student (matched by phone) or creates a
   * new one, flags obvious duplicates and auto-assigns when requested.
   */
  async create(payload, { actor, autoAssign = true, strategy } = {}) {
    return db.sequelize.transaction(async (transaction) => {
      const phone = String(payload.phone).trim();

      let student = await db.Student.findOne({ where: { phone }, transaction });
      if (!student) {
        student = await db.Student.create(
          {
            first_name: payload.first_name,
            last_name: payload.last_name,
            email: payload.email,
            phone,
            alternate_phone: payload.alternate_phone,
            city: payload.city,
            state: payload.state,
            qualification: payload.qualification,
          },
          { transaction }
        );
      }

      const duplicate = await db.Lead.findOne({
        where: { student_id: student.id },
        transaction,
      });

      const lead = await db.Lead.create(
        {
          reference_no: `LD-${refCode()}`,
          student_id: student.id,
          source_id: payload.source_id || null,
          status_id: payload.status_id || null,
          course: payload.course,
          intake: payload.intake,
          city: payload.city || student.city,
          priority: payload.priority || 'medium',
          pipeline_stage: 'new_lead',
          is_duplicate: !!duplicate,
          created_by: actor ? actor.id : null,
          meta: payload.meta || null,
        },
        { transaction }
      );

      await db.ActivityLog.create(
        {
          user_id: actor ? actor.id : null,
          subject_type: 'lead',
          subject_id: lead.id,
          action: 'lead.created',
          description: `Lead created for ${student.first_name} (${phone})`,
        },
        { transaction }
      );

      lead.student = student;
      lead._autoAssign = autoAssign;
      lead._strategy = strategy;
      return lead;
    }).then(async (lead) => {
      // Assignment + notification happen after the transaction commits.
      if (lead._autoAssign) {
        const assignee = await assignmentService.assign(lead, {
          strategy: lead._strategy || ASSIGNMENT_STRATEGIES.ROUND_ROBIN,
          assignedBy: actor ? actor.id : null,
        });
        if (assignee) {
          await notificationQueue.add(NOTIFICATION_EVENTS.NEW_LEAD, {
            userId: assignee.id,
            type: NOTIFICATION_EVENTS.NEW_LEAD,
            title: 'New lead assigned',
            body: `${lead.student.first_name} — ${lead.course || 'General enquiry'}`,
            data: { leadId: lead.id },
          });
        }
      }
      return leadRepository.findFullById(lead.id);
    });
  }

  async update(user, id, payload) {
    const lead = await this.getById(user, id);
    const updatable = [
      'source_id', 'status_id', 'course', 'intake', 'city', 'priority',
      'pipeline_stage', 'next_followup_at', 'tags', 'score',
    ];
    const changes = {};
    updatable.forEach((f) => {
      if (payload[f] !== undefined) changes[f] = payload[f];
    });
    await lead.update(changes);
    await db.ActivityLog.create({
      user_id: user.id,
      subject_type: 'lead',
      subject_id: lead.id,
      action: 'lead.updated',
      description: 'Lead details updated',
      properties: changes,
    });
    return leadRepository.findFullById(lead.id);
  }

  async assign(user, id, { userId, strategy, note }) {
    const lead = await db.Lead.findByPk(id);
    if (!lead) throw ApiError.notFound('Lead not found');
    const assignee = await assignmentService.assign(lead, {
      strategy: strategy || ASSIGNMENT_STRATEGIES.MANUAL,
      userId,
      assignedBy: user.id,
      note,
    });
    if (!assignee) throw ApiError.badRequest('No counselor available for assignment');
    await notificationQueue.add(NOTIFICATION_EVENTS.NEW_LEAD, {
      userId: assignee.id,
      type: NOTIFICATION_EVENTS.NEW_LEAD,
      title: 'Lead assigned to you',
      data: { leadId: lead.id },
    });
    return leadRepository.findFullById(lead.id);
  }

  /** Active counselors for the manual-assignment dropdown. */
  async assignees() {
    return assignmentService.activeCounselors();
  }

  /**
   * Assign many leads at once to a counselor (or via a strategy). Returns a
   * per-lead report so the UI can show partial failures.
   */
  async assignBulk(user, { ids = [], userId, strategy, note } = {}) {
    const list = [...new Set((ids || []).map(Number).filter(Boolean))];
    if (!list.length) throw ApiError.badRequest('No leads selected');
    if (!userId && !strategy) throw ApiError.badRequest('Choose a counselor or a strategy');

    const report = { total: list.length, assigned: 0, failed: 0, errors: [] };
    for (const id of list) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.assign(user, id, {
          userId,
          strategy: strategy || ASSIGNMENT_STRATEGIES.MANUAL,
          note,
        });
        report.assigned += 1;
      } catch (e) {
        report.failed += 1;
        report.errors.push({ id, message: e.message });
      }
    }
    return report;
  }

  async addNote(user, id, note) {
    const lead = await this.getById(user, id);
    return db.ActivityLog.create({
      user_id: user.id,
      subject_type: 'lead',
      subject_id: lead.id,
      action: 'lead.note',
      description: note,
    });
  }

  timeline(id) {
    return db.ActivityLog.findAll({
      where: { subject_type: 'lead', subject_id: id },
      include: [{ model: db.User, as: 'user', attributes: ['id', 'name'] }],
      order: [['created_at', 'DESC']],
      limit: 100,
    });
  }

  /** Merge a duplicate lead's history into a primary lead, then soft-delete it. */
  async merge(primaryId, duplicateId) {
    if (primaryId === duplicateId) throw ApiError.badRequest('Cannot merge a lead into itself');
    return db.sequelize.transaction(async (transaction) => {
      const [primary, dup] = await Promise.all([
        db.Lead.findByPk(primaryId, { transaction }),
        db.Lead.findByPk(duplicateId, { transaction }),
      ]);
      if (!primary || !dup) throw ApiError.notFound('Lead not found');

      // Re-point related records to the primary lead.
      await Promise.all([
        db.Followup.update({ lead_id: primaryId }, { where: { lead_id: duplicateId }, transaction }),
        db.CallLog.update({ lead_id: primaryId }, { where: { lead_id: duplicateId }, transaction }),
        db.ActivityLog.update(
          { subject_id: primaryId },
          { where: { subject_type: 'lead', subject_id: duplicateId }, transaction }
        ),
      ]);

      await dup.update({ is_duplicate: true, merged_into_id: primaryId }, { transaction });
      await dup.destroy({ transaction });
      return primary;
    });
  }

  async remove(user, id) {
    const ok = await leadRepository.destroy(id);
    if (!ok) throw ApiError.notFound('Lead not found');
    await db.ActivityLog.create({
      user_id: user.id,
      subject_type: 'lead',
      subject_id: id,
      action: 'lead.deleted',
      description: 'Lead deleted',
    });
    return true;
  }
}

module.exports = new LeadService();
