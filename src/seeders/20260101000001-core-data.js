'use strict';

const bcrypt = require('bcryptjs');
const { ROLES, PIPELINE_STAGES } = require('../utils/constants');

/**
 * Seeds the minimum data required to log in and operate the CRM:
 * roles, a full permission matrix, lead statuses/sources and a super admin.
 */
module.exports = {
  async up(queryInterface) {
    const now = new Date();

    // ---- Roles ----
    const roles = [
      { name: 'Super Admin', slug: ROLES.SUPER_ADMIN, description: 'Full system access' },
      { name: 'Admission Manager', slug: ROLES.ADMISSION_MANAGER, description: 'All leads and reports' },
      { name: 'Team Leader', slug: ROLES.TEAM_LEADER, description: 'Assign leads, monitor counselors' },
      { name: 'Counselor', slug: ROLES.COUNSELOR, description: 'Call leads and update follow-ups' },
      { name: 'QA Team', slug: ROLES.QA, description: 'Audit recordings' },
      { name: 'Management', slug: ROLES.MANAGEMENT, description: 'View analytics and KPIs' },
    ].map((r) => ({ ...r, is_system: true, created_at: now, updated_at: now }));
    await queryInterface.bulkInsert('roles', roles);

    const roleRows = await queryInterface.sequelize.query(
      'SELECT id, slug FROM roles',
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    );
    const roleId = Object.fromEntries(roleRows.map((r) => [r.slug, r.id]));

    // ---- Permissions (module.action) ----
    const modules = {
      dashboard: ['view'],
      leads: ['view', 'create', 'update', 'delete', 'import', 'assign', 'merge'],
      calls: ['view', 'create', 'recording.view', 'recording.download'],
      followups: ['view', 'create', 'update', 'delete'],
      admissions: ['view', 'create', 'update'],
      reports: ['view', 'export'],
      ai: ['view', 'analyze'],
      qa: ['view', 'audit'],
      users: ['view', 'create', 'update', 'delete'],
      settings: ['view', 'update'],
    };
    const permissions = [];
    for (const [mod, actions] of Object.entries(modules)) {
      for (const action of actions) {
        permissions.push({
          name: `${mod}.${action}`,
          slug: `${mod}.${action}`,
          module: mod,
          created_at: now,
          updated_at: now,
        });
      }
    }
    await queryInterface.bulkInsert('permissions', permissions);

    const permRows = await queryInterface.sequelize.query(
      'SELECT id, slug, module FROM permissions',
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    );

    // ---- Role -> permission matrix ----
    const grant = (slug, predicate) =>
      permRows
        .filter(predicate)
        .map((p) => ({ role_id: roleId[slug], permission_id: p.id, created_at: now, updated_at: now }));

    let rolePerms = [];
    // Super admin & manager: everything.
    rolePerms = rolePerms.concat(grant(ROLES.SUPER_ADMIN, () => true));
    rolePerms = rolePerms.concat(grant(ROLES.ADMISSION_MANAGER, () => true));
    // Team leader: most operational permissions except user/settings management.
    rolePerms = rolePerms.concat(
      grant(ROLES.TEAM_LEADER, (p) => !['users', 'settings'].includes(p.module))
    );
    // Counselor: own leads, calls, followups, admissions, dashboard.
    rolePerms = rolePerms.concat(
      grant(ROLES.COUNSELOR, (p) =>
        ['dashboard', 'leads', 'calls', 'followups', 'admissions', 'ai'].includes(p.module) &&
        !['leads.delete', 'leads.assign', 'leads.merge'].includes(p.slug)
      )
    );
    // QA: view + audit + recordings.
    rolePerms = rolePerms.concat(
      grant(ROLES.QA, (p) =>
        p.module === 'qa' ||
        p.slug.startsWith('calls.recording') ||
        ['dashboard.view', 'calls.view', 'ai.view'].includes(p.slug)
      )
    );
    // Management: read + reports/AI insights only.
    rolePerms = rolePerms.concat(
      grant(ROLES.MANAGEMENT, (p) =>
        p.slug.endsWith('.view') || p.module === 'reports' || p.module === 'ai'
      )
    );
    await queryInterface.bulkInsert('role_permissions', rolePerms);

    // ---- Super admin user ----
    const password = await bcrypt.hash('Admin@12345', 12);
    await queryInterface.bulkInsert('users', [
      {
        uuid: require('crypto').randomUUID(),
        name: 'Super Admin',
        email: 'admin@admissioncrm.local',
        phone: '0000000000',
        password,
        role_id: roleId[ROLES.SUPER_ADMIN],
        status: 'active',
        created_at: now,
        updated_at: now,
      },
    ]);

    // ---- Lead statuses mapped to pipeline stages ----
    const statusNames = {
      new_lead: 'New Lead',
      contacted: 'Contacted',
      interested: 'Interested',
      qualified: 'Qualified',
      application_started: 'Application Started',
      application_submitted: 'Application Submitted',
      offer_issued: 'Offer Issued',
      admission_confirmed: 'Admission Confirmed',
      enrollment_completed: 'Enrollment Completed',
    };
    const palette = ['#6366f1', '#0ea5e9', '#8b5cf6', '#06b6d4', '#f59e0b', '#f97316', '#14b8a6', '#22c55e', '#16a34a'];
    const statuses = PIPELINE_STAGES.map((stage, i) => ({
      name: statusNames[stage],
      slug: stage,
      pipeline_stage: stage,
      color: palette[i],
      sort_order: i,
      is_won: stage === 'enrollment_completed',
      is_lost: false,
      created_at: now,
      updated_at: now,
    }));
    await queryInterface.bulkInsert('lead_statuses', statuses);

    // ---- Lead sources ----
    const sources = [
      { name: 'Website', slug: 'website', channel: 'website' },
      { name: 'Facebook Leads', slug: 'facebook', channel: 'facebook' },
      { name: 'Excel Import', slug: 'excel', channel: 'excel' },
      { name: 'CSV Import', slug: 'csv', channel: 'csv' },
      { name: 'API', slug: 'api', channel: 'api' },
      { name: 'Walk In', slug: 'walk_in', channel: 'manual' },
    ].map((s) => ({ ...s, is_active: true, created_at: now, updated_at: now }));
    await queryInterface.bulkInsert('lead_sources', sources);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('role_permissions', null, {});
    await queryInterface.bulkDelete('user_permissions', null, {});
    await queryInterface.bulkDelete('users', null, {});
    await queryInterface.bulkDelete('permissions', null, {});
    await queryInterface.bulkDelete('lead_sources', null, {});
    await queryInterface.bulkDelete('lead_statuses', null, {});
    await queryInterface.bulkDelete('roles', null, {});
  },
};
