function trimValue(value) {
  return String(value || '')
    .replace(/\\r|\\n|\r|\n/g, '')
    .trim();
}

function isBrokerHostUsable(url) {
  const trimmed = trimValue(url);
  if (!trimmed) return false;
  // Expired or shut-down EMQX serverless test clusters
  if (trimmed.includes('u7f17112') || (trimmed.includes('emqxsl.com') && !trimmed.includes('broker.emqx.io'))) {
    return false;
  }
  return true;
}

const REGION_ORDER = ['eu', 'us', 'apac', 'primary'];

const REGION_DEFS = [
  {
    key: 'eu',
    label: 'Europe',
    prefixes: ['MQTT_BROKER_EU', 'MQTT_BROKER_EUROPE', 'MQTT_BROKER_EMEA']
  },
  {
    key: 'us',
    label: 'Americas',
    prefixes: ['MQTT_BROKER_US', 'MQTT_BROKER_AMERICAS', 'MQTT_BROKER_NA']
  },
  {
    key: 'apac',
    label: 'Asia Pacific',
    prefixes: ['MQTT_BROKER_APAC', 'MQTT_BROKER_ASIA', 'MQTT_BROKER_ASIA_PACIFIC']
  }
];

const REGION_ALIASES = {
  eu: 'eu',
  europe: 'eu',
  emea: 'eu',
  frankfurt: 'eu',
  germany: 'eu',
  tr: 'eu',
  turkey: 'eu',
  us: 'us',
  usa: 'us',
  na: 'us',
  america: 'us',
  americas: 'us',
  northamerica: 'us',
  north_america: 'us',
  'north-america': 'us',
  canada: 'us',
  apac: 'apac',
  asia: 'apac',
  asiapacific: 'apac',
  asia_pacific: 'apac',
  'asia-pacific': 'apac',
  japan: 'apac',
  jp: 'apac',
  oceania: 'apac',
  australia: 'apac',
  nz: 'apac',
  primary: 'primary',
  default: 'primary',
  legacy: 'primary'
};

function normalizeBrokerRegionKey(value) {
  const normalized = trimValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  return REGION_ALIASES[normalized] || '';
}

function inferRegionFromTimeZone(timeZone) {
  const zone = trimValue(timeZone);
  if (!zone) return '';
  if (zone.startsWith('America/')) return 'us';
  if (
    zone.startsWith('Asia/') ||
    zone.startsWith('Australia/') ||
    zone.startsWith('Pacific/')
  ) {
    return 'apac';
  }
  return 'eu';
}

function readBrokerFromPrefix(prefix, key, label, env) {
  const mqttBrokerUrl = trimValue(env[`${prefix}_URL`]);
  const mqttUsername = trimValue(env[`${prefix}_USERNAME`]);
  const mqttPassword = trimValue(env[`${prefix}_PASSWORD`]);
  if (!mqttBrokerUrl || !isBrokerHostUsable(mqttBrokerUrl) || !mqttUsername || !mqttPassword) return null;
  return {
    key,
    label,
    mqttBrokerUrl,
    mqttUsername,
    mqttPassword
  };
}

function readLegacyBroker(env) {
  const mqttBrokerUrl = trimValue(env.MQTT_BROKER_URL);
  const mqttUsername = trimValue(env.MQTT_USERNAME);
  const mqttPassword = trimValue(env.MQTT_PASSWORD);
  if (!mqttBrokerUrl || !isBrokerHostUsable(mqttBrokerUrl) || !mqttUsername || !mqttPassword) return null;
  return {
    key: 'primary',
    label: 'Primary',
    mqttBrokerUrl,
    mqttUsername,
    mqttPassword
  };
}

function getManagedBrokerEntries(env = process.env) {
  const entries = [];
  REGION_DEFS.forEach((definition) => {
    let entry = null;
    definition.prefixes.some((prefix) => {
      entry = readBrokerFromPrefix(prefix, definition.key, definition.label, env);
      return !!entry;
    });
    if (entry) entries.push(entry);
  });

  const legacyBroker = readLegacyBroker(env) || readBrokerFromPrefix('MQTT_BROKER', 'primary', 'Primary', env);
  if (legacyBroker) entries.push(legacyBroker);

  return REGION_ORDER
    .map((key) => entries.find((entry) => entry.key === key))
    .filter(Boolean);
}

function getManagedBrokerMap(env = process.env) {
  const map = {};
  getManagedBrokerEntries(env).forEach((entry) => {
    map[entry.key] = entry;
  });
  return map;
}

function pickManagedBroker(preferredRegion, timeZone, env = process.env) {
  const brokers = getManagedBrokerEntries(env);
  if (!brokers.length) return null;

  const brokerMap = getManagedBrokerMap(env);
  const explicit = normalizeBrokerRegionKey(preferredRegion);
  if (explicit && brokerMap[explicit]) return brokerMap[explicit];

  const inferred = inferRegionFromTimeZone(timeZone);
  if (inferred && brokerMap[inferred]) return brokerMap[inferred];

  return brokerMap.primary || brokerMap.eu || brokerMap.us || brokerMap.apac || brokers[0];
}

function getManagedBrokerForServerDoc(doc, env = process.env) {
  return pickManagedBroker(doc?.brokerRegion || doc?.brokerKey || '', doc?.timeZone || '', env);
}

module.exports = {
  getManagedBrokerEntries,
  getManagedBrokerMap,
  pickManagedBroker,
  getManagedBrokerForServerDoc,
  normalizeBrokerRegionKey,
  inferRegionFromTimeZone
};
