'use strict';

const db = require('../../models');
const logger = require('../../utils/logger');

/**
 * Email job. Logs the send in email_logs and (when SMTP is configured)
 * dispatches via nodemailer. Templates: welcome, brochure, admission_reminder,
 * offer_letter, password_reset.
 */
module.exports = async function emailJob(job) {
  const { to, subject, template, context = {}, leadId } = job.data;

  const log = await db.EmailLog.create({
    lead_id: leadId || null,
    to_email: to,
    subject: subject || templateSubject(template),
    template,
    status: 'queued',
  });

  try {
    if (!process.env.SMTP_HOST) {
      // Dev mode: no SMTP — record as sent and log the payload.
      logger.info(`[email:stub] -> ${to} (${template}) ${JSON.stringify(context).slice(0, 200)}`);
      await log.update({ status: 'sent' });
      return { sent: true, stub: true };
    }

    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    });
    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to,
      subject: log.subject,
      html: renderTemplate(template, context),
    });
    await log.update({ status: 'sent', provider_message_id: info.messageId });
    return { sent: true };
  } catch (err) {
    await log.update({ status: 'failed', error: err.message.slice(0, 500) });
    throw err;
  }
};

function templateSubject(template) {
  return (
    {
      welcome: 'Welcome to our Admissions Program',
      brochure: 'Your requested brochure',
      admission_reminder: 'Reminder: Complete your admission',
      offer_letter: 'Your Admission Offer Letter',
      password_reset: 'Reset your password',
    }[template] || 'Notification'
  );
}

function renderTemplate(template, ctx) {
  if (template === 'password_reset') {
    const url = `${process.env.APP_URL || ''}/reset-password?token=${ctx.token}`;
    return `<p>Hi ${ctx.name || ''},</p><p>Reset your password using the link below (valid 1 hour):</p><p><a href="${url}">${url}</a></p>`;
  }
  return `<p>Hi ${ctx.name || 'there'},</p><p>${ctx.message || 'Thank you for your interest in our programs.'}</p>`;
}
