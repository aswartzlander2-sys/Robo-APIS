import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyIp,
  getClientIp,
  lookupLocalIpRecord,
  normaliseLocalRecords
} from './network-utils.js';

const ROOT_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)));
const PORT = Number.parseInt(process.env.PORT ?? '3000', 10) || 3000;
const HOST = process.env.HOST ?? '0.0.0.0';
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
const LOCAL_IP_DATA_FILE = process.env.LOCAL_IP_DATA_FILE ?? 'ip-data.local.json';
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);
const PUBLIC_IP_API_ENABLED = process.env.PUBLIC_IP_API_ENABLED !== 'false';
const PUBLIC_IP_RATE_LIMIT = Math.max(1, Number.parseInt(process.env.PUBLIC_IP_RATE_LIMIT ?? '120', 10) || 120);
const PUBLIC_IP_RATE_WINDOW_MS = 60_000;
const PUBLIC_IP_DETAILS_MAX_BYTES = Math.max(1_024, Number.parseInt(process.env.PUBLIC_IP_DETAILS_MAX_BYTES ?? '65536', 10) || 65_536);
const PUBLIC_IP_API_PATH = normalisePublicApiPath(process.env.PUBLIC_IP_API_PATH ?? '/ipdata');
const PUBLIC_SITE_PATH = normalisePublicApiPath(process.env.PUBLIC_SITE_PATH ?? PUBLIC_IP_API_PATH);
const PUBLIC_IP_API_HEALTH_PATH = `${PUBLIC_IP_API_PATH}/health`;
const LEGACY_PUBLIC_IP_API_PATH = '/api/v1/ip';
const LEGACY_PUBLIC_IP_API_HEALTH_PATH = '/api/v1/health';
const localDataPath = resolve(ROOT_DIR, LOCAL_IP_DATA_FILE);
const localDataIsInsideProject = localDataPath.startsWith(`${ROOT_DIR}/`);

const STATIC_FILES = new Map([
  ['/', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/index.html', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/app.js', { file: 'app.js', type: 'text/javascript; charset=utf-8' }],
  ['/runtime-config.js', { file: 'runtime-config.js', type: 'text/javascript; charset=utf-8' }],
  ['/styles.css', { file: 'styles.css', type: 'text/css; charset=utf-8' }],
  ['/tailwind.css', { file: 'tailwind.css', type: 'text/css; charset=utf-8' }],
  ['/robo-logo.png', { file: 'robo-logo.png', type: 'image/png' }]
]);

let localDataCache = {
  mtimeMs: null,
  status: 'not configured',
  records: [],
  file: basename(localDataPath),
  message: 'No local IP data file is installed.'
};

function normalisePublicApiPath(value) {
  const path = typeof value === 'string' ? value.trim() : '';
  if (!path || !path.startsWith('/') || path.startsWith('//') || /[?#]/.test(path)) return '/ipdata';
  return path.replace(/\/+$/, '') || '/ipdata';
}

function pathMatches(pathname, endpoint) {
  return pathname === endpoint || pathname === `${endpoint}/`;
}

function staticPagePath(pathname) {
  // Keep /ipdata (no slash) for the JSON API while /ipdata/ serves the UI.
  if (pathname === `${PUBLIC_SITE_PATH}/`) return '/';
  if (pathname.startsWith(`${PUBLIC_SITE_PATH}/`)) return pathname.slice(PUBLIC_SITE_PATH.length);
  return pathname;
}

function send(response, status, body = '', headers = {}) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'text/plain; charset=utf-8',
    ...headers
  });
  response.end(body);
}

function sendJson(response, status, value) {
  send(response, status, JSON.stringify(value), {
    'content-type': 'application/json; charset=utf-8'
  });
}

function setSecurityHeaders(response) {
  response.setHeader('content-security-policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'"
  ].join('; '));
  response.setHeader('permissions-policy', 'geolocation=(self), camera=(), microphone=(), usb=(), payment=()');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('cross-origin-opener-policy', 'same-origin');
  response.setHeader('cross-origin-resource-policy', 'same-origin');
}

function setCorsHeaders(request, response, { publicApi = false } = {}) {
  if (publicApi) {
    // The public echo endpoint intentionally supports browser calls from any
    // origin. It returns only the caller's own address, never a queried target.
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    response.setHeader('access-control-allow-headers', 'Accept, Content-Type');
    response.setHeader('access-control-expose-headers', 'RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After');
    response.setHeader('cross-origin-resource-policy', 'cross-origin');
    return;
  }

  const origin = request.headers.origin;
  if (!origin || (!ALLOWED_ORIGINS.has('*') && !ALLOWED_ORIGINS.has(origin))) return;

  response.setHeader('access-control-allow-origin', ALLOWED_ORIGINS.has('*') ? '*' : origin);
  response.setHeader('access-control-allow-methods', 'GET, OPTIONS');
  response.setHeader('access-control-allow-headers', 'Accept');
  response.setHeader('vary', 'Origin');
}

function createPublicIpRateLimiter({ limit, windowMs }) {
  const buckets = new Map();
  const cleanup = setInterval(() => {
    const oldest = Date.now() - windowMs;
    for (const [key, bucket] of buckets) {
      if (bucket.startedAt < oldest) buckets.delete(key);
    }
  }, windowMs);
  cleanup.unref();

  return (identity) => {
    // Retain only a transient one-way hash so the limiter does not create an IP log.
    const key = createHash('sha256').update(identity || 'unavailable').digest('base64url');
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.startedAt >= windowMs) {
      bucket = { startedAt: now, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - bucket.startedAt)) / 1000));
    return {
      allowed: bucket.count <= limit,
      limit,
      remaining: Math.max(0, limit - bucket.count),
      retryAfterSeconds
    };
  };
}

const limitPublicIpApi = createPublicIpRateLimiter({
  limit: PUBLIC_IP_RATE_LIMIT,
  windowMs: PUBLIC_IP_RATE_WINDOW_MS
});

function publicRecord(record) {
  if (!record) return null;
  const allowedFields = [
    'cidr', 'country', 'countryCode', 'region', 'city', 'postal',
    'latitude', 'longitude', 'isp', 'organisation', 'asn', 'timezone'
  ];
  return Object.fromEntries(
    allowedFields
      .filter((field) => record[field] !== undefined && record[field] !== null && record[field] !== '')
      .map((field) => [field, record[field]])
  );
}

async function getLocalIpData() {
  if (!localDataIsInsideProject) {
    return {
      status: 'invalid configuration',
      file: basename(localDataPath),
      records: [],
      message: 'LOCAL_IP_DATA_FILE must remain inside the project folder.'
    };
  }

  try {
    const fileInfo = await stat(localDataPath);
    if (localDataCache.mtimeMs === fileInfo.mtimeMs) return localDataCache;

    const parsed = JSON.parse(await readFile(localDataPath, 'utf8'));
    const records = normaliseLocalRecords(parsed);
    localDataCache = {
      mtimeMs: fileInfo.mtimeMs,
      status: 'loaded',
      file: basename(localDataPath),
      records,
      message: records.length
        ? `${records.length} local IPv4 prefix record(s) loaded.`
        : 'The local data file contains no valid IPv4 prefix records.'
    };
    return localDataCache;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      localDataCache = {
        mtimeMs: null,
        status: 'not configured',
        file: basename(localDataPath),
        records: [],
        message: 'No local IP data file is installed.'
      };
    } else {
      localDataCache = {
        mtimeMs: null,
        status: 'invalid',
        file: basename(localDataPath),
        records: [],
        message: 'The local IP data file could not be parsed.'
      };
    }
    return localDataCache;
  }
}

function serverRequestInfo(request) {
  return {
    httpVersion: request.httpVersion ? `HTTP/${request.httpVersion}` : 'unknown',
    encrypted: Boolean(request.socket?.encrypted),
    socketFamily: request.socket?.remoteFamily ?? 'unknown',
    receivedAt: new Date().toISOString()
  };
}

async function buildNetworkProfile(request) {
  const client = getClientIp(request, TRUST_PROXY);
  const address = classifyIp(client.ip);
  const localData = await getLocalIpData();
  const matchedRecord = client.ip && address.publicRoutable
    ? lookupLocalIpRecord(client.ip, localData.records)
    : null;

  return {
    checkedAt: new Date().toISOString(),
    observedIp: client.ip,
    observedVia: client.source,
    address,
    serverRequest: serverRequestInfo(request),
    offlineIpData: {
      status: localData.status,
      file: localData.file,
      message: localData.message,
      recordCount: localData.records.length,
      matched: Boolean(matchedRecord),
      record: publicRecord(matchedRecord)
    }
  };
}

async function handleNetworkProfile(request, response) {
  sendJson(response, 200, await buildNetworkProfile(request));
}

async function handleFamilyProfile(request, response, requestedFamily) {
  const profile = await buildNetworkProfile(request);
  const observed = profile.address.family === requestedFamily ? profile.observedIp : null;
  const observedFamily = profile.address.family ?? 'unavailable';
  sendJson(response, 200, {
    ...profile,
    requestedFamily,
    requestedAddress: observed,
    requestResult: observed
      ? `${requestedFamily} observed on this same-origin request.`
      : `This same-origin request arrived as ${observedFamily}; no ${requestedFamily} address was observed.`
  });
}

function handlePing(request, response) {
  sendJson(response, 200, {
    serverTime: new Date().toISOString(),
    serverRequest: serverRequestInfo(request)
  });
}

function setRateLimitHeaders(response, rate) {
  response.setHeader('ratelimit-limit', String(rate.limit));
  response.setHeader('ratelimit-remaining', String(rate.remaining));
  response.setHeader('ratelimit-reset', String(rate.retryAfterSeconds));
}

async function readPublicDetails(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > PUBLIC_IP_DETAILS_MAX_BYTES) {
      const error = new Error(`Request body exceeds the ${PUBLIC_IP_DETAILS_MAX_BYTES}-byte limit.`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (!chunks.length) return null;
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object') {
      const error = new Error('Submitted details must be a JSON object or array.');
      error.statusCode = 400;
      throw error;
    }
    // Both { allDetails: {...} } and a direct All Details JSON payload are supported.
    return Object.hasOwn(value, 'allDetails') ? value.allDetails : value;
  } catch (error) {
    if (error.statusCode) throw error;
    const invalid = new Error('Request body must be valid JSON.');
    invalid.statusCode = 400;
    throw invalid;
  }
}

async function publicIpPayload(request, submittedDetails = null) {
  const profile = await buildNetworkProfile(request);
  const address = profile.address ?? {};
  const allDetails = {
    generatedAt: profile.checkedAt,
    application: 'Robo IP Data API',
    api: {
      version: 'v1',
      endpoint: PUBLIC_IP_API_PATH,
      requestMethod: request.method,
      detailsReturned: true,
      submittedDetailsReturned: submittedDetails !== null,
      submittedDetailsStored: false
    },
    serverObservedPublicAddress: profile,
    clientSubmittedAllDetails: submittedDetails
  };

  return {
    // Top-level values keep this compatible with ordinary IP-echo clients.
    ip: profile.observedIp,
    version: address.family,
    scope: address.scope,
    isPublic: address.publicRoutable,
    observedAt: profile.checkedAt,
    observedVia: profile.observedVia,
    service: 'Robo IP Data API',
    apiVersion: 'v1',
    serverRequest: profile.serverRequest,
    allDetails
  };
}

async function handlePublicIpApi(request, response, url) {
  if (!PUBLIC_IP_API_ENABLED) {
    sendJson(response, 404, { error: 'The public IP API is disabled.' });
    return;
  }

  const client = getClientIp(request, TRUST_PROXY);
  const rate = limitPublicIpApi(client.ip ?? request.socket?.remoteAddress ?? 'unavailable');
  setRateLimitHeaders(response, rate);

  if (!rate.allowed) {
    response.setHeader('retry-after', String(rate.retryAfterSeconds));
    sendJson(response, 429, {
      error: 'Rate limit exceeded. Try again shortly.',
      retryAfterSeconds: rate.retryAfterSeconds
    });
    return;
  }

  const format = (url.searchParams.get('format') ?? 'json').toLowerCase();
  if (request.method === 'POST' && format !== 'json') {
    sendJson(response, 400, { error: 'POST responses use JSON.' });
    return;
  }

  let submittedDetails = null;
  if (request.method === 'POST') {
    try {
      submittedDetails = await readPublicDetails(request);
    } catch (error) {
      sendJson(response, error.statusCode ?? 400, { error: error.message || 'Invalid submitted details.' });
      return;
    }
  }

  const payload = await publicIpPayload(request, submittedDetails);
  if (format === 'plain' || format === 'text' || format === 'txt') {
    send(response, 200, payload.ip ?? '', { 'content-type': 'text/plain; charset=utf-8' });
    return;
  }

  if (format !== 'json') {
    sendJson(response, 400, { error: 'Supported formats are json and plain.' });
    return;
  }

  sendJson(response, 200, payload);
}

function handlePublicApiHealth(_request, response) {
  if (!PUBLIC_IP_API_ENABLED) {
    sendJson(response, 404, { error: 'The public IP API is disabled.' });
    return;
  }
  sendJson(response, 200, {
    service: 'Robo Network Finder IP API',
    apiVersion: 'v1',
    status: 'ok',
    publicIpEndpoint: PUBLIC_IP_API_PATH,
    healthEndpoint: PUBLIC_IP_API_HEALTH_PATH,
    methods: ['GET', 'POST'],
    formats: ['json', 'plain'],
    postBehavior: 'Returns the caller IP and echoes submitted All Details JSON without storing it.'
  });
}

async function handleStatic(request, response, pathname) {
  const descriptor = STATIC_FILES.get(staticPagePath(pathname));
  if (!descriptor) {
    send(response, 404, 'Not found');
    return;
  }

  try {
    const body = request.method === 'HEAD' ? '' : await readFile(resolve(ROOT_DIR, descriptor.file));
    send(response, 200, body, {
      'content-type': descriptor.type,
      'cache-control': 'no-cache'
    });
  } catch {
    send(response, 500, 'Unable to load this file.');
  }
}

const server = createServer(async (request, response) => {
  setSecurityHeaders(response);
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  // /ipdata is the machine API. The trailing slash /ipdata/ is the UI.
  const isPublicIpEndpoint = url.pathname === PUBLIC_IP_API_PATH
    || url.pathname === LEGACY_PUBLIC_IP_API_PATH;
  const isPublicHealthEndpoint = pathMatches(url.pathname, PUBLIC_IP_API_HEALTH_PATH)
    || pathMatches(url.pathname, LEGACY_PUBLIC_IP_API_HEALTH_PATH);
  const isPublicIpApiRoute = isPublicIpEndpoint || isPublicHealthEndpoint;
  setCorsHeaders(request, response, { publicApi: isPublicIpApiRoute });

  if (request.method === 'OPTIONS' && (url.pathname.startsWith('/api/network/') || isPublicIpApiRoute)) {
    send(response, 204, '', { allow: isPublicIpEndpoint ? 'GET, POST, OPTIONS' : 'GET, OPTIONS' });
    return;
  }

  if (isPublicIpEndpoint) {
    if (!['GET', 'POST'].includes(request.method ?? 'GET')) return send(response, 405, 'Method not allowed', { allow: 'GET, POST, OPTIONS' });
    await handlePublicIpApi(request, response, url);
    return;
  }

  if (isPublicHealthEndpoint) {
    if (request.method !== 'GET') return send(response, 405, 'Method not allowed', { allow: 'GET, OPTIONS' });
    handlePublicApiHealth(request, response);
    return;
  }

  if (url.pathname === '/api/network/profile') {
    if (request.method !== 'GET') return send(response, 405, 'Method not allowed', { allow: 'GET' });
    await handleNetworkProfile(request, response);
    return;
  }

  if (url.pathname === '/api/network/ipv4') {
    if (request.method !== 'GET') return send(response, 405, 'Method not allowed', { allow: 'GET' });
    await handleFamilyProfile(request, response, 'IPv4');
    return;
  }

  if (url.pathname === '/api/network/ipv6') {
    if (request.method !== 'GET') return send(response, 405, 'Method not allowed', { allow: 'GET' });
    await handleFamilyProfile(request, response, 'IPv6');
    return;
  }

  if (url.pathname === '/api/network/ping') {
    if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) return send(response, 405, 'Method not allowed', { allow: 'GET, HEAD' });
    handlePing(request, response);
    return;
  }

  if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) {
    send(response, 405, 'Method not allowed', { allow: 'GET, HEAD' });
    return;
  }

  await handleStatic(request, response, url.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`Robo Network Finder is listening on http://${HOST}:${PORT}`);
  console.log(`Trusted reverse proxy headers: ${TRUST_PROXY ? 'enabled' : 'disabled'}`);
  console.log(`Local IP data file: ${localDataIsInsideProject ? basename(localDataPath) : 'invalid configuration'}`);
  console.log(`Allowed API origins: ${ALLOWED_ORIGINS.size ? [...ALLOWED_ORIGINS].join(', ') : 'same-origin only'}`);
  console.log(`Public IP API: ${PUBLIC_IP_API_ENABLED ? `enabled at ${PUBLIC_IP_API_PATH} (${PUBLIC_IP_RATE_LIMIT}/minute per transient hashed address)` : 'disabled'}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
