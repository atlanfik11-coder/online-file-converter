const DEFAULT_PUBLIC_BROKER = 'wss://broker.emqx.io:8084/mqtt';
const { getManagedBrokerEntries } = require('./_lib/broker-config');
const FREE_MAX_MEMBERS_PER_SERVER = 10;

function clampMembers(value) {
  const parsed = parseInt(value || String(FREE_MAX_MEMBERS_PER_SERVER), 10);
  if (!Number.isFinite(parsed)) return FREE_MAX_MEMBERS_PER_SERVER;
  return Math.min(FREE_MAX_MEMBERS_PER_SERVER, Math.max(2, parsed));
}

module.exports = function handler(req, res) {
  const managedBrokers = getManagedBrokerEntries(process.env);
  const primaryManagedBroker = managedBrokers[0] || null;
  const rawRequireManaged = String(process.env.REQUIRE_MANAGED_BACKEND || '').replace(/\\r|\\n|\r|\n/g, '').trim() === '1';
  const requireManagedBackend = managedBrokers.length > 0 && rawRequireManaged;
  const maxMembersPerServer = clampMembers(process.env.MAX_MEMBERS_PER_SERVER);
  const serverRegistryReady = !!String(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim()
    && !!String(process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  const unlimitedServerPrice = 0;
  const unlimitedServerFeatureEnabled = false;
  const unlimitedServerCheckoutEnabled = false;

  const mqttBrokerUrl = primaryManagedBroker?.mqttBrokerUrl || DEFAULT_PUBLIC_BROKER;
  const backendMode = managedBrokers.length ? 'managed' : 'public';
  const managedBackendReady = true;

  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.status(200).json({
    mqttBrokerUrl,
    backendMode,
    requireManagedBackend,
    managedBackendReady,
    serverRegistryReady,
    maxMembersPerServer,
    realtimeAuthRequired: !!managedBrokers.length,
    brokerPoolEnabled: managedBrokers.length > 1,
    managedBrokerCount: managedBrokers.length,
    availableBrokerRegions: managedBrokers.map((broker) => broker.key),
    unlimitedServerPrice,
    unlimitedServerFeatureEnabled,
    unlimitedServerPurchaseEnabled: unlimitedServerCheckoutEnabled,
    unlimitedServerCheckoutMode: 'free',
    unlimitedServerPaymentProvider: 'none'
  });
};
