'use strict';

/**
 * Contract every cloud-telephony provider adapter must implement. Keeping a
 * common interface lets the rest of the system stay provider-agnostic and
 * swap Exotel/Knowlarity/MyOperator/Ozonetel via config only.
 */
class BaseProvider {
  constructor(config) {
    this.config = config;
    this.name = 'base';
  }

  /**
   * Bridge a call between an agent and a customer (click-to-call).
   * @returns {Promise<{providerCallId:string, status:string, raw:object}>}
   */
  // eslint-disable-next-line no-unused-vars
  async clickToCall({ agentNumber, customerNumber, callerId, leadId }) {
    throw new Error('clickToCall not implemented');
  }

  /**
   * Normalise a provider webhook payload into our canonical call shape.
   * @returns {{providerCallId, status, direction, from, to, duration, recordingUrl, startedAt, endedAt, raw}}
   */
  // eslint-disable-next-line no-unused-vars
  parseWebhook(payload) {
    throw new Error('parseWebhook not implemented');
  }

  /** Verify webhook authenticity (signature/secret). */
  // eslint-disable-next-line no-unused-vars
  verifyWebhook(req) {
    return true;
  }
}

module.exports = BaseProvider;
