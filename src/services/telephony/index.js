'use strict';

const config = require('../../config');
const ExotelProvider = require('./ExotelProvider');

/**
 * Provider factory. Knowlarity / MyOperator / Ozonetel adapters follow the
 * same BaseProvider contract and can be registered here; Exotel is the
 * reference implementation and the default fallback.
 */
const registry = {
  exotel: ExotelProvider,
  // knowlarity: KnowlarityProvider,
  // myoperator: MyOperatorProvider,
  // ozonetel: OzonetelProvider,
};

function getProvider(name = config.telephony.provider) {
  const Provider = registry[name] || ExotelProvider;
  const providerConfig = {
    ...(config.telephony[name] || config.telephony.exotel),
    webhookSecret: config.telephony.webhookSecret,
  };
  return new Provider(providerConfig);
}

module.exports = { getProvider, registry };
