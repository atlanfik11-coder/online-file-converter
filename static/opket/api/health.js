const { getManagedBrokerEntries } = require('./_lib/broker-config');

function hasValue(value) {
  return !!String(value || '').trim();
}

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  const managedBrokers = getManagedBrokerEntries(process.env);
  const managedBrokerReady = managedBrokers.length > 0;
  const mqttAuthReady = managedBrokerReady;
  const serverRegistryReady =
    hasValue(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) &&
    hasValue(process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN);
  const turnReady =
    hasValue(process.env.TURN_URLS) &&
    (
      (hasValue(process.env.TURN_USERNAME) && hasValue(process.env.TURN_PASSWORD)) ||
      hasValue(process.env.TURN_AUTH_SECRET)
    );

  return res.status(200).json({
    ok: true,
    timestamp: Date.now(),
    backendMode: managedBrokerReady ? 'managed' : 'public',
    managedBrokerReady,
    managedBrokerCount: managedBrokers.length,
    managedBrokerRegions: managedBrokers.map((broker) => broker.key),
    brokerPoolEnabled: managedBrokers.length > 1,
    mqttAuthReady,
    realtimeAuthReady: managedBrokerReady && mqttAuthReady && serverRegistryReady,
    serverRegistryReady,
    turnReady,
    turnMode: hasValue(process.env.TURN_AUTH_SECRET) ? 'shared-secret' : ((hasValue(process.env.TURN_USERNAME) && hasValue(process.env.TURN_PASSWORD)) ? 'static-creds' : 'disabled'),
    rateLimitBackend: serverRegistryReady ? 'redis' : 'memory'
  });
};
