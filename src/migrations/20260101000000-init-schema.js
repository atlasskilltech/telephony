'use strict';

/**
 * Initial schema migration — creates every table for the Admission CRM in
 * dependency order with foreign keys, indexes and soft-delete columns.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { BIGINT, STRING, TEXT, INTEGER, BOOLEAN, DATE, DATEONLY, JSON, ENUM, DECIMAL, UUID } =
      Sequelize;
    const t = (extra = {}) => ({ type: DATE, allowNull: true, ...extra });

    // Standard audit/timestamp columns appended to most tables.
    const audit = () => ({
      created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      deleted_at: { type: DATE, allowNull: true },
    });
    const id = () => ({ type: BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true });
    const fk = (table, opts = {}) => ({
      type: BIGINT.UNSIGNED,
      allowNull: opts.allowNull !== false,
      references: { model: table, key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: opts.onDelete || 'SET NULL',
    });

    // Every table in this system shares the `telephony_` prefix. Wrap the
    // queryInterface so table names — and the FK reference targets declared
    // via fk() — are prefixed in one place rather than on every literal.
    const PREFIX = 'telephony_';
    const qi = {
      createTable: (name, attrs, opts) => {
        Object.values(attrs).forEach((col) => {
          if (col && col.references && col.references.model) {
            col.references.model = PREFIX + col.references.model;
          }
        });
        return queryInterface.createTable(PREFIX + name, attrs, opts);
      },
      addIndex: (name, ...rest) => queryInterface.addIndex(PREFIX + name, ...rest),
    };

    // ---- roles ----
    await qi.createTable('roles', {
      id: id(),
      name: { type: STRING(100), allowNull: false },
      slug: { type: STRING(60), allowNull: false, unique: true },
      description: { type: STRING(255), allowNull: true },
      is_system: { type: BOOLEAN, defaultValue: false },
      ...audit(),
    });

    // ---- permissions ----
    await qi.createTable('permissions', {
      id: id(),
      name: { type: STRING(120), allowNull: false },
      slug: { type: STRING(120), allowNull: false, unique: true },
      module: { type: STRING(60), allowNull: true },
      description: { type: STRING(255), allowNull: true },
      ...audit(),
    });

    // ---- role_permissions (join) ----
    await qi.createTable('role_permissions', {
      id: id(),
      role_id: fk('roles', { allowNull: false, onDelete: 'CASCADE' }),
      permission_id: fk('permissions', { allowNull: false, onDelete: 'CASCADE' }),
      created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await qi.addIndex('role_permissions', ['role_id', 'permission_id'], { unique: true });

    // ---- users ----
    await qi.createTable('users', {
      id: id(),
      uuid: { type: UUID, allowNull: false },
      name: { type: STRING(150), allowNull: false },
      email: { type: STRING(190), allowNull: false, unique: true },
      phone: { type: STRING(20), allowNull: true },
      password: { type: STRING(255), allowNull: false },
      role_id: fk('roles', { allowNull: false, onDelete: 'RESTRICT' }),
      team_leader_id: fk('users'),
      agent_extension: { type: STRING(40), allowNull: true },
      avatar_url: { type: STRING(255), allowNull: true },
      status: { type: ENUM('active', 'inactive', 'suspended'), defaultValue: 'active' },
      last_login_at: t(),
      reset_token: { type: STRING(255), allowNull: true },
      reset_token_expires: t(),
      created_by: { type: BIGINT.UNSIGNED, allowNull: true },
      ...audit(),
    });
    await qi.addIndex('users', ['role_id']);
    await qi.addIndex('users', ['team_leader_id']);
    await qi.addIndex('users', ['status']);

    // ---- user_permissions ----
    await qi.createTable('user_permissions', {
      id: id(),
      user_id: fk('users', { allowNull: false, onDelete: 'CASCADE' }),
      permission_id: fk('permissions', { allowNull: false, onDelete: 'CASCADE' }),
      effect: { type: ENUM('allow', 'deny'), defaultValue: 'allow' },
      created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await qi.addIndex('user_permissions', ['user_id', 'permission_id'], { unique: true });

    // ---- refresh_tokens ----
    await qi.createTable('refresh_tokens', {
      id: id(),
      user_id: fk('users', { allowNull: false, onDelete: 'CASCADE' }),
      token_hash: { type: STRING(255), allowNull: false },
      device_name: { type: STRING(150), allowNull: true },
      device_id: { type: STRING(150), allowNull: true },
      ip_address: { type: STRING(64), allowNull: true },
      user_agent: { type: STRING(255), allowNull: true },
      expires_at: { type: DATE, allowNull: false },
      revoked_at: t(),
      created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await qi.addIndex('refresh_tokens', ['user_id']);
    await qi.addIndex('refresh_tokens', ['token_hash']);

    // ---- lead_sources ----
    await qi.createTable('lead_sources', {
      id: id(),
      name: { type: STRING(100), allowNull: false },
      slug: { type: STRING(80), allowNull: false, unique: true },
      channel: { type: STRING(40), allowNull: true },
      is_active: { type: BOOLEAN, defaultValue: true },
      ...audit(),
    });

    // ---- lead_statuses ----
    await qi.createTable('lead_statuses', {
      id: id(),
      name: { type: STRING(80), allowNull: false },
      slug: { type: STRING(80), allowNull: false, unique: true },
      pipeline_stage: { type: STRING(60), allowNull: true },
      color: { type: STRING(20), defaultValue: '#6366f1' },
      sort_order: { type: INTEGER, defaultValue: 0 },
      is_won: { type: BOOLEAN, defaultValue: false },
      is_lost: { type: BOOLEAN, defaultValue: false },
      ...audit(),
    });

    // ---- students ----
    await qi.createTable('students', {
      id: id(),
      uuid: { type: UUID, allowNull: false },
      first_name: { type: STRING(100), allowNull: false },
      last_name: { type: STRING(100), allowNull: true },
      email: { type: STRING(190), allowNull: true },
      phone: { type: STRING(20), allowNull: false },
      alternate_phone: { type: STRING(20), allowNull: true },
      gender: { type: ENUM('male', 'female', 'other'), allowNull: true },
      date_of_birth: { type: DATEONLY, allowNull: true },
      city: { type: STRING(100), allowNull: true },
      state: { type: STRING(100), allowNull: true },
      country: { type: STRING(100), defaultValue: 'India' },
      pincode: { type: STRING(12), allowNull: true },
      qualification: { type: STRING(150), allowNull: true },
      meta: { type: JSON, allowNull: true },
      ...audit(),
    });
    await qi.addIndex('students', ['phone']);
    await qi.addIndex('students', ['email']);
    await qi.addIndex('students', ['city']);

    // ---- student_documents ----
    await qi.createTable('student_documents', {
      id: id(),
      student_id: fk('students', { allowNull: false, onDelete: 'CASCADE' }),
      type: { type: STRING(60), allowNull: false },
      file_name: { type: STRING(255), allowNull: false },
      file_url: { type: STRING(512), allowNull: false },
      storage_driver: { type: ENUM('local', 's3'), defaultValue: 'local' },
      mime_type: { type: STRING(120), allowNull: true },
      size_bytes: { type: INTEGER.UNSIGNED, allowNull: true },
      uploaded_by: fk('users'),
      ...audit(),
    });
    await qi.addIndex('student_documents', ['student_id']);

    // ---- leads ----
    await qi.createTable('leads', {
      id: id(),
      uuid: { type: UUID, allowNull: false },
      reference_no: { type: STRING(40), allowNull: true, unique: true },
      student_id: fk('students', { allowNull: false, onDelete: 'CASCADE' }),
      source_id: fk('lead_sources'),
      status_id: fk('lead_statuses'),
      assigned_to: fk('users'),
      pipeline_stage: { type: STRING(60), defaultValue: 'new_lead' },
      course: { type: STRING(150), allowNull: true },
      intake: { type: STRING(60), allowNull: true },
      city: { type: STRING(100), allowNull: true },
      score: { type: INTEGER, defaultValue: 0 },
      priority: { type: ENUM('low', 'medium', 'high', 'hot'), defaultValue: 'medium' },
      ai_interest_score: { type: DECIMAL(5, 2), allowNull: true },
      ai_admission_probability: { type: DECIMAL(5, 2), allowNull: true },
      last_contacted_at: t(),
      next_followup_at: t(),
      is_duplicate: { type: BOOLEAN, defaultValue: false },
      merged_into_id: { type: BIGINT.UNSIGNED, allowNull: true },
      tags: { type: JSON, allowNull: true },
      meta: { type: JSON, allowNull: true },
      created_by: { type: BIGINT.UNSIGNED, allowNull: true },
      ...audit(),
    });
    await qi.addIndex('leads', ['assigned_to']);
    await qi.addIndex('leads', ['status_id']);
    await qi.addIndex('leads', ['source_id']);
    await qi.addIndex('leads', ['pipeline_stage']);
    await qi.addIndex('leads', ['next_followup_at']);
    await qi.addIndex('leads', ['assigned_to', 'pipeline_stage']);
    await qi.addIndex('leads', ['course', 'city']);

    // ---- lead_assignments ----
    await qi.createTable('lead_assignments', {
      id: id(),
      lead_id: fk('leads', { allowNull: false, onDelete: 'CASCADE' }),
      assigned_to: fk('users', { allowNull: false }),
      assigned_by: fk('users'),
      strategy: { type: STRING(40), defaultValue: 'manual' },
      note: { type: STRING(255), allowNull: true },
      is_active: { type: BOOLEAN, defaultValue: true },
      ...audit(),
    });
    await qi.addIndex('lead_assignments', ['lead_id']);
    await qi.addIndex('lead_assignments', ['assigned_to']);

    // ---- followups ----
    await qi.createTable('followups', {
      id: id(),
      lead_id: fk('leads', { allowNull: false, onDelete: 'CASCADE' }),
      user_id: fk('users', { allowNull: false }),
      title: { type: STRING(180), allowNull: false },
      notes: { type: TEXT, allowNull: true },
      channel: { type: STRING(40), defaultValue: 'call' },
      scheduled_at: { type: DATE, allowNull: false },
      completed_at: t(),
      status: { type: ENUM('pending', 'completed', 'overdue', 'cancelled'), defaultValue: 'pending' },
      recurrence: { type: STRING(40), allowNull: true },
      reminder_sent: { type: BOOLEAN, defaultValue: false },
      ...audit(),
    });
    await qi.addIndex('followups', ['lead_id']);
    await qi.addIndex('followups', ['user_id']);
    await qi.addIndex('followups', ['status']);
    await qi.addIndex('followups', ['scheduled_at']);

    // ---- call_logs ----
    await qi.createTable('call_logs', {
      id: id(),
      uuid: { type: UUID, allowNull: false },
      provider: { type: STRING(40), allowNull: true },
      provider_call_id: { type: STRING(120), allowNull: true, unique: true },
      lead_id: fk('leads', { onDelete: 'SET NULL' }),
      agent_id: fk('users'),
      direction: { type: ENUM('inbound', 'outbound'), defaultValue: 'outbound' },
      from_number: { type: STRING(20), allowNull: true },
      to_number: { type: STRING(20), allowNull: true },
      status: { type: STRING(30), defaultValue: 'initiated' },
      duration_seconds: { type: INTEGER.UNSIGNED, defaultValue: 0 },
      talk_time_seconds: { type: INTEGER.UNSIGNED, defaultValue: 0 },
      is_missed: { type: BOOLEAN, defaultValue: false },
      recording_url: { type: STRING(512), allowNull: true },
      started_at: t(),
      ended_at: t(),
      meta: { type: JSON, allowNull: true },
      ...audit(),
    });
    await qi.addIndex('call_logs', ['lead_id']);
    await qi.addIndex('call_logs', ['agent_id']);
    await qi.addIndex('call_logs', ['status']);
    await qi.addIndex('call_logs', ['agent_id', 'started_at']);

    // ---- call_recordings ----
    await qi.createTable('call_recordings', {
      id: id(),
      call_id: fk('call_logs', { allowNull: false, onDelete: 'CASCADE' }),
      source_url: { type: STRING(512), allowNull: true },
      storage_driver: { type: ENUM('local', 's3'), defaultValue: 'local' },
      storage_key: { type: STRING(512), allowNull: true },
      file_size_bytes: { type: INTEGER.UNSIGNED, allowNull: true },
      duration_seconds: { type: INTEGER.UNSIGNED, allowNull: true },
      format: { type: STRING(20), defaultValue: 'mp3' },
      status: { type: ENUM('pending', 'archived', 'failed'), defaultValue: 'pending' },
      archived_at: t(),
      ...audit(),
    });
    await qi.addIndex('call_recordings', ['call_id']);
    await qi.addIndex('call_recordings', ['status']);

    // ---- call_transcripts ----
    await qi.createTable('call_transcripts', {
      id: id(),
      call_id: fk('call_logs', { allowNull: false, onDelete: 'CASCADE' }),
      language: { type: STRING(20), allowNull: true },
      text: { type: TEXT('long'), allowNull: true },
      segments: { type: JSON, allowNull: true },
      speaker_map: { type: JSON, allowNull: true },
      confidence: { type: DECIMAL(5, 4), allowNull: true },
      model: { type: STRING(60), allowNull: true },
      processing_ms: { type: INTEGER.UNSIGNED, allowNull: true },
      status: { type: ENUM('queued', 'processing', 'completed', 'failed'), defaultValue: 'queued' },
      error: { type: STRING(512), allowNull: true },
      ...audit(),
    });
    await qi.addIndex('call_transcripts', ['call_id']);
    await qi.addIndex('call_transcripts', ['status']);

    // ---- call_analysis ----
    await qi.createTable('call_analysis', {
      id: id(),
      call_id: fk('call_logs', { allowNull: false, onDelete: 'CASCADE' }),
      interest_score: { type: DECIMAL(5, 2), allowNull: true },
      admission_probability: { type: DECIMAL(5, 2), allowNull: true },
      sentiment: { type: ENUM('positive', 'neutral', 'negative'), allowNull: true },
      sentiment_score: { type: DECIMAL(5, 2), allowNull: true },
      risk_score: { type: DECIMAL(5, 2), allowNull: true },
      summary: { type: TEXT, allowNull: true },
      next_action: { type: STRING(255), allowNull: true },
      followup_recommendation: { type: TEXT, allowNull: true },
      objections: { type: JSON, allowNull: true },
      keywords: { type: JSON, allowNull: true },
      intent: { type: STRING(120), allowNull: true },
      qa_scores: { type: JSON, allowNull: true },
      call_quality_score: { type: DECIMAL(5, 2), allowNull: true },
      agent_score: { type: DECIMAL(5, 2), allowNull: true },
      improvement_suggestions: { type: JSON, allowNull: true },
      model: { type: STRING(60), allowNull: true },
      status: { type: ENUM('queued', 'processing', 'completed', 'failed'), defaultValue: 'queued' },
      error: { type: STRING(512), allowNull: true },
      ...audit(),
    });
    await qi.addIndex('call_analysis', ['call_id']);
    await qi.addIndex('call_analysis', ['sentiment']);
    await qi.addIndex('call_analysis', ['status']);

    // ---- notifications ----
    await qi.createTable('notifications', {
      id: id(),
      user_id: fk('users', { allowNull: false, onDelete: 'CASCADE' }),
      type: { type: STRING(60), allowNull: false },
      title: { type: STRING(180), allowNull: false },
      body: { type: STRING(512), allowNull: true },
      data: { type: JSON, allowNull: true },
      read_at: t(),
      created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await qi.addIndex('notifications', ['user_id', 'read_at']);
    await qi.addIndex('notifications', ['type']);

    // ---- activity_logs ----
    await qi.createTable('activity_logs', {
      id: id(),
      user_id: fk('users'),
      subject_type: { type: STRING(60), allowNull: false },
      subject_id: { type: BIGINT.UNSIGNED, allowNull: false },
      action: { type: STRING(80), allowNull: false },
      description: { type: STRING(512), allowNull: true },
      properties: { type: JSON, allowNull: true },
      created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await qi.addIndex('activity_logs', ['subject_type', 'subject_id']);
    await qi.addIndex('activity_logs', ['user_id']);

    // ---- audit_logs ----
    await qi.createTable('audit_logs', {
      id: id(),
      user_id: fk('users'),
      action: { type: STRING(120), allowNull: false },
      entity: { type: STRING(60), allowNull: true },
      entity_id: { type: STRING(60), allowNull: true },
      ip_address: { type: STRING(64), allowNull: true },
      user_agent: { type: STRING(255), allowNull: true },
      method: { type: STRING(10), allowNull: true },
      path: { type: STRING(255), allowNull: true },
      status_code: { type: INTEGER, allowNull: true },
      changes: { type: JSON, allowNull: true },
      created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await qi.addIndex('audit_logs', ['user_id']);
    await qi.addIndex('audit_logs', ['action']);
    await qi.addIndex('audit_logs', ['entity', 'entity_id']);

    // ---- whatsapp_logs ----
    await qi.createTable('whatsapp_logs', {
      id: id(),
      lead_id: fk('leads', { onDelete: 'SET NULL' }),
      to_number: { type: STRING(20), allowNull: false },
      template: { type: STRING(120), allowNull: true },
      trigger: { type: STRING(60), allowNull: true },
      payload: { type: JSON, allowNull: true },
      provider_message_id: { type: STRING(120), allowNull: true },
      status: { type: ENUM('queued', 'sent', 'delivered', 'read', 'failed'), defaultValue: 'queued' },
      error: { type: STRING(512), allowNull: true },
      created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await qi.addIndex('whatsapp_logs', ['lead_id']);
    await qi.addIndex('whatsapp_logs', ['status']);

    // ---- email_logs ----
    await qi.createTable('email_logs', {
      id: id(),
      lead_id: fk('leads', { onDelete: 'SET NULL' }),
      to_email: { type: STRING(190), allowNull: false },
      subject: { type: STRING(255), allowNull: true },
      template: { type: STRING(120), allowNull: true },
      provider_message_id: { type: STRING(190), allowNull: true },
      status: {
        type: ENUM('queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed'),
        defaultValue: 'queued',
      },
      opened_at: t(),
      clicked_at: t(),
      open_count: { type: INTEGER.UNSIGNED, defaultValue: 0 },
      click_count: { type: INTEGER.UNSIGNED, defaultValue: 0 },
      error: { type: STRING(512), allowNull: true },
      created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await qi.addIndex('email_logs', ['lead_id']);
    await qi.addIndex('email_logs', ['status']);

    // ---- applications ----
    await qi.createTable('applications', {
      id: id(),
      application_no: { type: STRING(40), allowNull: false, unique: true },
      lead_id: fk('leads', { allowNull: false, onDelete: 'CASCADE' }),
      student_id: fk('students', { allowNull: false, onDelete: 'CASCADE' }),
      course: { type: STRING(150), allowNull: false },
      intake: { type: STRING(60), allowNull: true },
      status: {
        type: ENUM('started', 'submitted', 'under_review', 'offer_issued', 'accepted', 'rejected', 'withdrawn'),
        defaultValue: 'started',
      },
      fee_quoted: { type: DECIMAL(12, 2), allowNull: true },
      submitted_at: t(),
      meta: { type: JSON, allowNull: true },
      ...audit(),
    });
    await qi.addIndex('applications', ['lead_id']);
    await qi.addIndex('applications', ['student_id']);
    await qi.addIndex('applications', ['status']);

    // ---- admissions ----
    await qi.createTable('admissions', {
      id: id(),
      admission_no: { type: STRING(40), allowNull: false, unique: true },
      application_id: fk('applications', { allowNull: false, onDelete: 'CASCADE' }),
      student_id: fk('students', { allowNull: false, onDelete: 'CASCADE' }),
      counselor_id: fk('users'),
      course: { type: STRING(150), allowNull: false },
      intake: { type: STRING(60), allowNull: true },
      status: { type: ENUM('confirmed', 'enrolled', 'cancelled'), defaultValue: 'confirmed' },
      fee_paid: { type: DECIMAL(12, 2), allowNull: true },
      confirmed_at: t(),
      enrolled_at: t(),
      ...audit(),
    });
    await qi.addIndex('admissions', ['counselor_id']);
    await qi.addIndex('admissions', ['status']);
    await qi.addIndex('admissions', ['student_id']);

    // ---- settings ----
    await qi.createTable('settings', {
      id: id(),
      user_id: fk('users', { onDelete: 'CASCADE' }),
      key: { type: STRING(120), allowNull: false },
      value: { type: JSON, allowNull: true },
      created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await qi.addIndex('settings', ['user_id', 'key'], { unique: true });

    // ---- system_configs ----
    await qi.createTable('system_configs', {
      id: id(),
      key: { type: STRING(120), allowNull: false, unique: true },
      value: { type: JSON, allowNull: true },
      group: { type: STRING(60), allowNull: true },
      description: { type: STRING(255), allowNull: true },
      is_secret: { type: BOOLEAN, defaultValue: false },
      created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
  },

  async down(queryInterface) {
    // Drop in reverse dependency order.
    const tables = [
      'system_configs', 'settings', 'admissions', 'applications', 'email_logs',
      'whatsapp_logs', 'audit_logs', 'activity_logs', 'notifications', 'call_analysis',
      'call_transcripts', 'call_recordings', 'call_logs', 'followups', 'lead_assignments',
      'leads', 'student_documents', 'students', 'lead_statuses', 'lead_sources',
      'refresh_tokens', 'user_permissions', 'users', 'role_permissions', 'permissions', 'roles',
    ];
    for (const table of tables) {
      await queryInterface.dropTable(`telephony_${table}`);
    }
  },
};
