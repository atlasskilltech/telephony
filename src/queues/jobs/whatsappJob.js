'use strict';

const axios = require('axios');
const db = require('../../models');
const logger = require('../../utils/logger');

/**
 * WhatsApp job. Logs to whatsapp_logs and POSTs to the configured WhatsApp
 * Business API endpoint. Triggers: new_lead, brochure, fee_inquiry,
 * followup_reminder, admission_confirmation.
 */
module.exports = async function whatsappJob(job) {
  const { toNumber, template, trigger, payload = {}, leadId } = job.data;

  const log = await db.WhatsappLog.create({
    lead_id: leadId || null,
    to_number: toNumber,
    template,
    trigger,
    payload,
    status: 'queued',
  });

  try {
    if (!process.env.WHATSAPP_API_URL) {
      logger.info(`[whatsapp:stub] -> ${toNumber} (${template})`);
      await log.update({ status: 'sent' });
      return { sent: true, stub: true };
    }
    const res = await axios.post(
      process.env.WHATSAPP_API_URL,
      { to: toNumber, template, components: payload },
      { headers: { Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}` }, timeout: 15000 }
    );
    await log.update({ status: 'sent', provider_message_id: res.data?.messages?.[0]?.id });
    return { sent: true };
  } catch (err) {
    await log.update({ status: 'failed', error: err.message.slice(0, 500) });
    throw err;
  }
};
