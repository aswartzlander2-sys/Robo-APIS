const $ = (id) => document.getElementById(id);
const state = {
  browserNetwork: null,
  publicProfile: null,
  publicProfileError: null,
  familyChecks: {
    IPv4: { status: 'not requested' },
    IPv6: { status: 'not requested' }
  },
  latency: { status: 'not requested' },
  localCandidates: { status: 'not requested' },
  preciseLocation: { status: 'not requested' },
  geolocationPermission: 'unknown'
};

const runtimeConfig = globalThis.ROBO_NETWORK_CONFIG ?? {};
const DEFAULT_PUBLIC_IP_ENDPOINT = 'https://apis.robo-universe.com/ipdata';
const configuredMode = runtimeConfig.mode ?? 'auto';
const configuredApiBase = normaliseConfiguredEndpoint(runtimeConfig.apiBase);
// A Pages branch can omit runtime-config.js. Keep the deployed Worker usable in
// that case instead of falling back to nonexistent same-origin API routes.
const configuredPublicIpEndpoint = normaliseConfiguredEndpoint(runtimeConfig.publicIpEndpoint)
  || DEFAULT_PUBLIC_IP_ENDPOINT;
const hasPublicIpApi = Boolean(configuredPublicIpEndpoint);
const isGitHubPagesHost = /\.github\.io$/i.test(location.hostname);
const isLoopbackHost = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i.test(location.hostname);
// A custom GitHub Pages domain does not end in github.io. When a public
// Worker endpoint is configured, treat non-local auto deployments as static
// rather than attempting unavailable same-origin Node routes.
const isStaticDeployment = configuredMode === 'static'
  || (configuredMode === 'auto' && (isGitHubPagesHost || (!isLoopbackHost && hasPublicIpApi && !configuredApiBase)));
const hasServerApi = !isStaticDeployment;

function normaliseConfiguredEndpoint(value) {
  if (typeof value !== 'string') return '';
  const endpoint = value.trim();
  if (!endpoint || endpoint === '/') return endpoint;
  return endpoint.replace(/\/+$/, '');
}

function apiUrl(path) {
  return configuredApiBase ? `${configuredApiBase}${path}` : path;
}

function staticModeMessage() {
  if (hasPublicIpApi) {
    return 'The Robo IP Data API is configured for public IP, server-observed details, and request timing.';
  }
  return configuredApiBase
    ? 'Static deployment is enabled. Switch runtime-config.js to api mode to use the configured API.'
    : 'GitHub Pages is static and cannot observe a visitor IP. Configure your own API in runtime-config.js to enable public IP, IPv4, IPv6, and latency checks.';
}

function set(id, value) {
  const element = $(id);
  if (element) element.textContent = (value ?? '—').toString();
}

function yn(value) {
  return value === true ? 'yes' : value === false ? 'no' : (value ?? 'unknown');
}

function currentTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
  } catch {
    return 'unknown';
  }
}

function currentLocale() {
  return navigator.languages?.length ? navigator.languages.join(', ') : (navigator.language || 'unknown');
}

function getConnection() {
  return navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
}

function duration(start, end) {
  return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end >= start
    ? Math.round((end - start) * 10) / 10
    : null;
}

function formatMs(value) {
  return Number.isFinite(value) ? `${value} ms` : 'unknown';
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return 'unknown';
  const units = ['B', 'KB', 'MB', 'GB'];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount >= 10 || index === 0 ? Math.round(amount) : amount.toFixed(2)} ${units[index]}`;
}

function formatDate(value) {
  if (!value) return 'unknown';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'unknown' : date.toLocaleString();
}

function collectBrowserNetwork() {
  const connection = getConnection();
  const navigation = performance.getEntriesByType('navigation')[0];
  const resourceCount = performance.getEntriesByType('resource').length;
  const secureStart = navigation?.secureConnectionStart;

  return {
    collectedAt: new Date().toISOString(),
    browser: {
      userAgent: navigator.userAgent || null,
      platform: navigator.platform || null,
      language: navigator.language || null,
      languages: navigator.languages ? [...navigator.languages] : [],
      timezone: currentTimezone(),
      online: navigator.onLine,
      cookieEnabled: navigator.cookieEnabled
    },
    connection: {
      apiAvailable: Boolean(connection),
      type: connection?.type ?? null,
      effectiveType: connection?.effectiveType ?? null,
      downlinkMbps: connection?.downlink ?? null,
      downlinkMaxMbps: connection?.downlinkMax ?? null,
      rttMs: connection?.rtt ?? null,
      saveData: connection?.saveData ?? null
    },
    capabilities: {
      webRtc: Boolean(window.RTCPeerConnection),
      geolocation: Boolean(navigator.geolocation),
      permissionsApi: Boolean(navigator.permissions?.query),
      serviceWorker: Boolean(navigator.serviceWorker),
      webSocket: Boolean(window.WebSocket),
      webTransport: Boolean(window.WebTransport),
      fetch: Boolean(window.fetch)
    },
    page: {
      protocol: location.protocol || null,
      host: location.host || null,
      secureContext: window.isSecureContext,
      resourceCount
    },
    navigationTiming: navigation ? {
      nextHopProtocol: navigation.nextHopProtocol || null,
      type: navigation.type || null,
      redirectCount: navigation.redirectCount ?? null,
      dnsLookupMs: duration(navigation.domainLookupStart, navigation.domainLookupEnd),
      tcpConnectMs: duration(navigation.connectStart, navigation.connectEnd),
      tlsHandshakeMs: secureStart > 0 ? duration(secureStart, navigation.connectEnd) : null,
      requestPhaseMs: duration(navigation.requestStart, navigation.responseStart),
      responseTtfbMs: duration(navigation.requestStart, navigation.responseStart),
      domInteractiveMs: duration(navigation.startTime, navigation.domInteractive),
      domCompleteMs: duration(navigation.startTime, navigation.domComplete),
      domContentLoadedMs: duration(navigation.startTime, navigation.domContentLoadedEventEnd),
      loadEventMs: duration(navigation.startTime, navigation.loadEventEnd),
      durationMs: Number.isFinite(navigation.duration) ? Math.round(navigation.duration * 10) / 10 : null,
      transferSize: navigation.transferSize ?? null,
      encodedBodySize: navigation.encodedBodySize ?? null,
      decodedBodySize: navigation.decodedBodySize ?? null
    } : null
  };
}

function renderBrowserNetwork(data) {
  const { connection, page, navigationTiming, capabilities, browser } = data;

  set('nw-online', yn(browser.online));
  set('nw-type', connection.type || 'unknown');
  set('nw-effective', connection.effectiveType || 'unknown');
  set('nw-downlink', connection.downlinkMbps != null ? `${connection.downlinkMbps} Mbps` : 'unknown');
  set('nw-downmax', connection.downlinkMaxMbps != null ? `${connection.downlinkMaxMbps} Mbps` : 'unknown');
  set('nw-rtt', connection.rttMs != null ? `${connection.rttMs} ms` : 'unknown');
  set('nw-save', yn(connection.saveData));
  set('nw-protocol', page.protocol || 'unknown');
  set('nw-host', page.host || 'unknown');
  set('nw-secure', yn(page.secureContext));

  set('tr-network-api', connection.apiAvailable ? 'available' : 'unavailable');
  set('tr-next-hop', navigationTiming?.nextHopProtocol || 'unknown');
  set('tr-nav-type', navigationTiming?.type || 'unknown');
  set('tr-redirects', navigationTiming?.redirectCount ?? 'unknown');
  set('tr-page-protocol', page.protocol || 'unknown');
  set('tr-secure-context', yn(page.secureContext));
  set('tr-transfer', formatBytes(navigationTiming?.transferSize));
  set('tr-encoded', formatBytes(navigationTiming?.encodedBodySize));
  set('tr-decoded', formatBytes(navigationTiming?.decodedBodySize));
  set('tr-resource-count', page.resourceCount);
  set('tr-timezone', browser.timezone);
  set('tr-locale', currentLocale());

  set('tm-dns', formatMs(navigationTiming?.dnsLookupMs));
  set('tm-tcp', formatMs(navigationTiming?.tcpConnectMs));
  set('tm-tls', navigationTiming?.tlsHandshakeMs === null ? 'not applicable / unknown' : formatMs(navigationTiming?.tlsHandshakeMs));
  set('tm-request', formatMs(navigationTiming?.requestPhaseMs));
  set('tm-ttfb', formatMs(navigationTiming?.responseTtfbMs));
  set('tm-dom-interactive', formatMs(navigationTiming?.domInteractiveMs));
  set('tm-dom-complete', formatMs(navigationTiming?.domCompleteMs));
  set('tm-dom-content', formatMs(navigationTiming?.domContentLoadedMs));
  set('tm-load', formatMs(navigationTiming?.loadEventMs));
  set('tm-duration', formatMs(navigationTiming?.durationMs));

  set('ln-webrtc', capabilities.webRtc ? 'available' : 'unavailable');
  set('ln-geo-api', capabilities.geolocation ? 'available' : 'unavailable');
  set('ln-geo-permission', state.geolocationPermission);
}

function refreshNetwork() {
  const data = collectBrowserNetwork();
  state.browserNetwork = data;
  renderBrowserNetwork(data);
  updateAllData();
}

function setGeolocationUnavailable(value = 'unavailable') {
  [
    'ip-country', 'ip-region', 'ip-city', 'ip-postal', 'ip-lat',
    'ip-lon', 'ip-org', 'ip-asn', 'ip-tz', 'ip-match'
  ].forEach((id) => set(id, value));
}

function textOrNull(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function countryName(countryCode) {
  if (!/^[A-Z]{2}$/i.test(countryCode || '')) return null;
  try {
    return new Intl.DisplayNames([navigator.language || 'en'], { type: 'region' }).of(countryCode.toUpperCase()) || null;
  } catch {
    return countryCode.toUpperCase();
  }
}

function formatCountry(record) {
  if (!record?.country) return 'unavailable';
  if (!record.countryCode || record.country === record.countryCode) return record.country;
  return `${record.country} (${record.countryCode})`;
}

function publicIpApiProfile(payload) {
  const returnedDetails = payload?.allDetails && typeof payload.allDetails === 'object'
    ? payload.allDetails
    : null;
  const serverProfile = returnedDetails?.serverObservedPublicAddress;

  // The Robo IP Data API returns this exact profile for every caller. Preserve
  // it as-is so the All Details panel includes the API's returned JSON.
  if (serverProfile && typeof serverProfile === 'object') {
    return {
      ...serverProfile,
      sourceType: 'public-ip-api',
      observedIp: serverProfile.observedIp || textOrNull(payload?.ip),
      observedVia: serverProfile.observedVia || textOrNull(payload?.observedVia) || 'Robo IP Data API request',
      publicIpEndpoint: configuredPublicIpEndpoint,
      apiAllDetails: returnedDetails
    };
  }

  const ip = textOrNull(payload?.ip);
  const family = payload?.version === 'IPv4' || payload?.version === 'IPv6' ? payload.version : null;
  const scope = textOrNull(payload?.scope);
  const geo = payload?.geo && typeof payload.geo === 'object' ? payload.geo : {};
  const transport = payload?.transport && typeof payload.transport === 'object' ? payload.transport : {};
  const countryCode = textOrNull(geo.countryCode || geo.country)?.toUpperCase() || null;
  const organisation = textOrNull(geo.organization || geo.asOrganization);
  const asnNumber = numberOrNull(geo.asn);
  const record = {
    country: textOrNull(geo.countryName || geo.country) || countryName(countryCode) || countryCode,
    countryCode,
    region: textOrNull(geo.region),
    city: textOrNull(geo.city),
    postal: textOrNull(geo.postalCode || geo.postal),
    latitude: numberOrNull(geo.latitude),
    longitude: numberOrNull(geo.longitude),
    isp: organisation,
    organisation: null,
    asn: asnNumber ? `AS${asnNumber}` : textOrNull(geo.asn),
    timezone: textOrNull(geo.timezone)
  };
  const metadataAvailable = Object.values(record).some((value) => value !== null && value !== undefined && value !== '');
  const checkedAt = textOrNull(payload?.observedAt) || new Date().toISOString();

  return {
    sourceType: 'public-ip-api',
    checkedAt,
    observedIp: ip,
    observedVia: textOrNull(payload?.observedVia) || 'Robo IP Data API request',
    address: {
      family,
      scope,
      publicRoutable: typeof payload?.isPublic === 'boolean' ? payload.isPublic : null
    },
    serverRequest: payload?.serverRequest || {
      httpVersion: textOrNull(transport.httpProtocol),
      encrypted: transport.encrypted ?? null,
      socketFamily: family,
      receivedAt: checkedAt
    },
    publicIpEndpoint: configuredPublicIpEndpoint,
    apiAllDetails: returnedDetails,
    offlineIpData: {
      status: metadataAvailable ? 'API metadata available' : 'IP API available',
      file: metadataAvailable ? 'API response' : null,
      message: metadataAvailable
        ? 'Public IP and API metadata were returned by the Robo IP Data API.'
        : 'The Robo IP Data API returned the caller address; no optional IP metadata was provided.',
      recordCount: metadataAvailable ? 1 : 0,
      matched: metadataAvailable,
      record: metadataAvailable ? record : null
    }
  };
}

async function fetchPublicIpJson({ sendAllDetails = false } = {}) {
  if (!hasPublicIpApi) throw new Error('No public IP API is configured.');
  const url = configuredPublicIpEndpoint;
  const sameOrigin = new URL(url, location.href).origin === location.origin;
  const request = {
    cache: 'no-store',
    credentials: sameOrigin ? 'same-origin' : 'omit',
    headers: { accept: 'application/json' }
  };

  if (sendAllDetails) {
    request.method = 'POST';
    request.headers['content-type'] = 'application/json';
    // Do not include a prior API echo inside the next submitted payload.
    request.body = JSON.stringify({ allDetails: buildAllData({ includeApiReturnedDetails: false }) });
  }

  let response = await fetch(url, request);
  // The IP remains useful even if a caller's optional details JSON is too large.
  if (sendAllDetails && response.status === 413) {
    response = await fetch(url, {
      cache: 'no-store',
      credentials: sameOrigin ? 'same-origin' : 'omit',
      headers: { accept: 'application/json' }
    });
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(`Public IP request failed: ${response.status}`);
  return data;
}

function renderPublicFamilyFields(profile) {
  const family = profile?.address?.family;
  const ip = profile?.observedIp;
  if (family === 'IPv4') set('nw-ipv4', ip || 'unavailable');
  else if (state.familyChecks.IPv4.status === 'not requested') set('nw-ipv4', 'not observed');
  if (family === 'IPv6') set('nw-ipv6', ip || 'unavailable');
  else if (state.familyChecks.IPv6.status === 'not requested') set('nw-ipv6', 'not observed');
}

function renderPublicProfile(profile) {
  if (!profile) {
    set('nw-ip', 'unavailable');
    set('ip-family', 'unavailable');
    set('ip-scope', 'unavailable');
    set('ip-via', 'unavailable');
    set('ip-data-file', 'unavailable');
    set('ip-data-match', 'unavailable');
    setGeolocationUnavailable();
    return;
  }

  const address = profile.address ?? {};
  const offline = profile.offlineIpData ?? {};
  const record = offline.record;
  const fromPublicIpApi = profile.sourceType === 'public-ip-api';
  set('nw-ip', profile.observedIp || 'unavailable');
  renderPublicFamilyFields(profile);
  set('ip-family', address.family || 'unavailable');
  set('ip-scope', address.scope || 'unavailable');
  set('ip-via', profile.observedVia || 'unavailable');
  set('ip-data-file', offline.file || 'unavailable');
  set('ip-data-match', fromPublicIpApi
    ? (offline.matched ? 'API metadata' : 'not provided')
    : (offline.matched ? (record?.cidr || 'yes') : 'no'));
  set('tr-server-http', fromPublicIpApi ? (profile.serverRequest?.httpVersion || 'API server') : (profile.serverRequest?.httpVersion || 'unknown'));
  set('tr-server-encrypted', yn(profile.serverRequest?.encrypted));
  set('tr-seen', fromPublicIpApi ? formatDate(profile.checkedAt) : formatDate(profile.serverRequest?.receivedAt));

  set('st-external', fromPublicIpApi ? 'Robo IP Data API' : 'no');
  set('st-ip-source', fromPublicIpApi ? 'API-observed caller request' : 'self-hosted server request');
  set('st-profile-endpoint', fromPublicIpApi ? (profile.publicIpEndpoint || 'not configured') : '/api/network/profile');
  set('st-ipv4-endpoint', fromPublicIpApi ? (profile.publicIpEndpoint || 'not configured') : '/api/network/ipv4');
  set('st-ipv6-endpoint', fromPublicIpApi ? (profile.publicIpEndpoint || 'not configured') : '/api/network/ipv6');
  set('st-latency-endpoint', fromPublicIpApi ? (profile.publicIpEndpoint || 'not configured') : '/api/network/ping');
  set('st-data-status', offline.status || 'unknown');
  set('st-data-file', offline.file || 'not provided');
  set('st-record-count', offline.recordCount ?? 'unknown');
  set('st-matched-cidr', fromPublicIpApi ? 'not applicable' : (record?.cidr || 'none'));
  set('st-data-family', fromPublicIpApi ? 'API request metadata' : 'IPv4 prefixes');
  set('st-data-type', fromPublicIpApi ? 'Robo IP Data API JSON' : 'local JSON CIDR');
  set('st-address-check', `${address.family || 'unknown'} / ${address.scope || 'unknown'}`);
  set('st-last-check', formatDate(profile.checkedAt));

  if (!record) {
    setGeolocationUnavailable();
    set('offline-note', offline.message || 'Standalone mode: no local IP database is configured.');
    return;
  }

  set('ip-country', formatCountry(record));
  set('ip-region', record.region || 'unavailable');
  set('ip-city', record.city || 'unavailable');
  set('ip-postal', record.postal || 'unavailable');
  set('ip-lat', record.latitude ?? 'unavailable');
  set('ip-lon', record.longitude ?? 'unavailable');
  set('ip-org', [...new Set([record.isp, record.organisation].filter(Boolean))].join(' / ') || 'unavailable');
  set('ip-asn', record.asn || 'unavailable');
  set('ip-tz', record.timezone || 'unavailable');
  set('ip-match', record.timezone ? yn(record.timezone === currentTimezone()) : 'unknown');
  set('offline-note', fromPublicIpApi
    ? offline.message
    : `${offline.message} Matched local record: ${record.cidr || 'unknown prefix'}.`);
}

function renderStaticMode() {
  const message = staticModeMessage();
  set('nw-ip', 'requires API');
  set('nw-ipv4', 'requires API');
  set('nw-ipv6', 'requires API');
  set('ip-family', 'unavailable');
  set('ip-scope', 'unavailable');
  set('ip-via', 'static GitHub Pages');
  set('ip-data-file', 'not available in static mode');
  set('ip-data-match', 'unavailable');
  setGeolocationUnavailable();
  set('tr-server-http', 'static host');
  set('tr-server-encrypted', 'host managed');
  set('tr-seen', 'no server API');
  set('st-external', hasPublicIpApi ? 'Robo public IP API configured' : 'no');
  set('st-ip-source', hasPublicIpApi ? 'available on request' : 'not available in static mode');
  set('st-profile-endpoint', hasPublicIpApi ? configuredPublicIpEndpoint : (configuredApiBase || 'not configured'));
  set('st-ipv4-endpoint', hasPublicIpApi ? configuredPublicIpEndpoint : (configuredApiBase || 'not configured'));
  set('st-ipv6-endpoint', hasPublicIpApi ? configuredPublicIpEndpoint : (configuredApiBase || 'not configured'));
  set('st-latency-endpoint', configuredApiBase || 'not configured');
  set('st-data-status', hasPublicIpApi ? 'public IP API configured' : 'static mode');
  set('st-data-file', 'not available');
  set('st-record-count', 'unavailable');
  set('st-matched-cidr', 'unavailable');
  set('st-data-family', 'unavailable');
  set('st-data-type', 'not bundled');
  set('st-address-check', 'requires API');
  set('st-last-check', 'not available');
  set('tm-latest-rtt', 'requires API');
  set('tm-median-rtt', 'requires API');
  set('tm-spread', 'requires API');
  set('tm-success', 'requires API');
  set('offline-note', message);
}

async function fetchServerJson(path) {
  if (!hasServerApi) throw new Error('No server API is configured for this static deployment.');
  const url = apiUrl(path);
  const sameOrigin = new URL(url, location.href).origin === location.origin;
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: sameOrigin ? 'same-origin' : 'omit',
    headers: { accept: 'application/json' }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(`Request failed: ${response.status}`);
  return data;
}

async function refreshPublicProfile() {
  if (!hasServerApi) {
    if (!hasPublicIpApi) {
      state.publicProfile = null;
      state.publicProfileError = staticModeMessage();
      renderStaticMode();
      updateAllData();
      return;
    }

    renderStaticMode();
    set('nw-ip', 'checking…');
    try {
      const profile = publicIpApiProfile(await fetchPublicIpJson({ sendAllDetails: true }));
      state.publicProfile = profile;
      state.publicProfileError = null;
      renderPublicProfile(profile);
    } catch (error) {
      state.publicProfile = null;
      state.publicProfileError = error?.message || 'The Robo public IP request failed.';
      renderStaticMode();
      set('offline-note', 'The configured Robo public IP API could not be reached. Detailed network fields remain unavailable in static mode.');
    } finally {
      updateAllData();
    }
    return;
  }

  set('nw-ip', 'checking…');
  try {
    const profile = await fetchServerJson('/api/network/profile');
    state.publicProfile = profile;
    state.publicProfileError = null;
    renderPublicProfile(profile);
  } catch (error) {
    state.publicProfile = null;
    state.publicProfileError = error?.message || 'The standalone IP check failed.';
    renderPublicProfile(null);
    set('offline-note', 'Standalone IP check unavailable. No third-party service was contacted.');
  } finally {
    updateAllData();
  }
}

async function requestPublicFamily(family) {
  if (!hasServerApi) {
    if (!hasPublicIpApi) {
      const message = staticModeMessage();
      state.familyChecks[family] = { status: 'unavailable', reason: message };
      set(family === 'IPv4' ? 'nw-ipv4' : 'nw-ipv6', 'requires API');
      updateAllData();
      return;
    }

    const profile = publicIpApiProfile(await fetchPublicIpJson());
    const observed = profile.address.family === family ? profile.observedIp : null;
    state.publicProfile = profile;
    state.publicProfileError = null;
    state.familyChecks[family] = {
      status: observed ? 'observed' : 'not observed',
      checkedAt: profile.checkedAt,
      requestedAddress: observed,
      requestResult: observed
        ? `${family} was observed by the Robo public IP API.`
        : `The Robo public IP API received ${profile.address.family || 'an unknown address family'}; no ${family} address was observed.`,
      observedVia: 'Robo public IP API',
      endpoint: configuredPublicIpEndpoint
    };
    renderPublicProfile(profile);
    set(family === 'IPv4' ? 'nw-ipv4' : 'nw-ipv6', observed || 'not observed');
    updateAllData();
    return;
  }

  const path = family === 'IPv4' ? '/api/network/ipv4' : '/api/network/ipv6';
  const result = await fetchServerJson(path);
  state.familyChecks[family] = {
    status: result.requestedAddress ? 'observed' : 'not observed',
    checkedAt: result.checkedAt,
    requestedAddress: result.requestedAddress,
    requestResult: result.requestResult,
    observedVia: result.observedVia,
    serverRequest: result.serverRequest
  };
  set(family === 'IPv4' ? 'nw-ipv4' : 'nw-ipv6', result.requestedAddress || 'not observed');
  updateAllData();
}

function bindUpdate(id, action) {
  const button = $(id);
  if (!button) return;
  button.addEventListener('click', async () => {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Updating…';
    try {
      await action();
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });
}

function bindRequest(id, action) {
  const button = $(id);
  if (!button) return;
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Requesting…';
    try {
      await action();
      button.textContent = 'Update';
    } catch (error) {
      button.textContent = 'Try Again';
      console.warn('Request failed:', error);
    } finally {
      button.disabled = false;
      updateAllData();
    }
  });
}

function isIpv4(value) {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value);
}

function isIpv6(value) {
  return value.includes(':') && !value.endsWith('.local');
}

function isMdns(value) {
  return value.toLowerCase().endsWith('.local');
}

function collectLocalCandidates() {
  return new Promise((resolve, reject) => {
    if (!window.RTCPeerConnection) {
      reject(new Error('unsupported'));
      return;
    }

    // Host candidates only: no STUN/TURN server, LAN scan, or peer connection.
    const peer = new RTCPeerConnection({ iceServers: [] });
    const candidates = new Set();
    let complete = false;

    const finish = () => {
      if (complete) return;
      complete = true;
      try { peer.close(); } catch { /* no-op */ }
      const all = [...candidates];
      resolve({
        status: 'complete',
        all,
        ipv4: all.filter(isIpv4),
        ipv6: all.filter(isIpv6),
        mdns: all.filter(isMdns),
        collectedAt: new Date().toISOString(),
        externalStunOrTurnUsed: false
      });
    };

    peer.createDataChannel('robo-network-finder');
    peer.onicecandidate = (event) => {
      if (!event.candidate) {
        finish();
        return;
      }
      const fields = event.candidate.candidate.trim().split(/\s+/);
      const typePosition = fields.indexOf('typ');
      const address = fields[4];
      const candidateType = typePosition >= 0 ? fields[typePosition + 1] : null;
      if (address && candidateType === 'host') candidates.add(address);
    };
    peer.createOffer()
      .then((offer) => peer.setLocalDescription(offer))
      .catch(() => finish());
    window.setTimeout(finish, 4_000);
  });
}

function listOrNone(values) {
  return values?.length ? values.join(', ') : 'none found';
}

function renderLocalCandidates(result) {
  state.localCandidates = result;
  const all = result.all ?? [];
  const ipv4 = result.ipv4 ?? [];
  const ipv6 = result.ipv6 ?? [];
  const mdns = result.mdns ?? [];
  set('op-webrtc', listOrNone(all));
  set('ln-all', listOrNone(all));
  set('ln-ipv4', listOrNone(ipv4));
  set('ln-ipv6', listOrNone(ipv6));
  set('ln-mdns', listOrNone(mdns));
  set('ln-ipv4-count', ipv4.length);
  set('ln-ipv6-count', ipv6.length);
  set('ln-mdns-count', mdns.length);
}

async function requestLocalCandidates() {
  try {
    renderLocalCandidates(await collectLocalCandidates());
  } catch (error) {
    const result = { status: 'unavailable', error: error?.message || 'unavailable', all: [], ipv4: [], ipv6: [], mdns: [] };
    state.localCandidates = result;
    set('op-webrtc', `denied: ${result.error}`);
    set('ln-all', `denied: ${result.error}`);
    set('ln-ipv4', 'unavailable');
    set('ln-ipv6', 'unavailable');
    set('ln-mdns', 'unavailable');
  }
}

function getPreciseLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('unsupported'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = position.coords;
        resolve({
          status: 'granted',
          latitude: Number(coords.latitude.toFixed(6)),
          longitude: Number(coords.longitude.toFixed(6)),
          accuracyMeters: Math.round(coords.accuracy),
          altitudeMeters: coords.altitude == null ? null : Math.round(coords.altitude),
          altitudeAccuracyMeters: coords.altitudeAccuracy == null ? null : Math.round(coords.altitudeAccuracy),
          headingDegrees: coords.heading == null ? null : Math.round(coords.heading),
          speedMetersPerSecond: coords.speed == null ? null : Number(coords.speed.toFixed(2)),
          capturedAt: new Date(position.timestamp).toISOString(),
          transmittedToServer: false
        });
      },
      (error) => reject(new Error(error.message || 'unavailable')),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 }
    );
  });
}

function renderPreciseLocation(result) {
  state.preciseLocation = result;
  if (result.status !== 'granted') {
    set('op-geo', `denied: ${result.error || 'unavailable'}`);
    set('ln-geo-request', `denied: ${result.error || 'unavailable'}`);
    set('ln-geo-captured', 'no');
    set('ln-geo-accuracy', 'unknown');
    return;
  }

  const details = [
    `${result.latitude.toFixed(6)}, ${result.longitude.toFixed(6)}`,
    `accuracy ±${result.accuracyMeters}m`
  ];
  if (result.altitudeMeters != null) details.push(`alt ${result.altitudeMeters}m ±${result.altitudeAccuracyMeters ?? 0}m`);
  if (result.headingDegrees != null) details.push(`heading ${result.headingDegrees}°`);
  if (result.speedMetersPerSecond != null) details.push(`speed ${result.speedMetersPerSecond.toFixed(2)} m/s`);
  details.push(`timestamp ${new Date(result.capturedAt).toLocaleTimeString()}`);
  const output = details.join(' • ');
  set('op-geo', output);
  set('ln-geo-request', output);
  set('ln-geo-captured', formatDate(result.capturedAt));
  set('ln-geo-accuracy', `±${result.accuracyMeters} m`);
}

async function requestPreciseLocation() {
  try {
    renderPreciseLocation(await getPreciseLocation());
  } catch (error) {
    renderPreciseLocation({ status: 'unavailable', error: error?.message || 'unavailable' });
  }
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function pingSample() {
  const started = performance.now();
  const data = hasServerApi
    ? await fetchServerJson(`/api/network/ping?nonce=${encodeURIComponent(`${Date.now()}-${Math.random()}`)}`)
    : await fetchPublicIpJson();
  return {
    milliseconds: Math.round((performance.now() - started) * 10) / 10,
    serverTime: data.serverTime || data.observedAt || null,
    serverRequest: data.serverRequest || {
      httpVersion: data?.edge?.httpProtocol || null,
      encrypted: data?.edge?.tlsVersion ? true : null,
      receivedAt: data.observedAt || null
    }
  };
}

async function requestLatency() {
  if (!hasServerApi && !hasPublicIpApi) {
    state.latency = { status: 'unavailable', reason: staticModeMessage() };
    set('tm-latest-rtt', 'requires API');
    set('tm-median-rtt', 'requires API');
    set('tm-spread', 'requires API');
    set('tm-success', 'requires API');
    return;
  }

  const samples = [];
  let last = null;
  for (let index = 0; index < 3; index += 1) {
    try {
      const sample = await pingSample();
      samples.push(sample.milliseconds);
      last = sample;
    } catch {
      // Preserve the final successful count without exposing browser internals.
    }
  }

  const sampleSpread = samples.length > 1 ? Math.max(...samples) - Math.min(...samples) : null;
  state.latency = {
    status: samples.length ? 'complete' : 'unavailable',
    requestedSamples: 3,
    successfulSamples: samples.length,
    samplesMs: samples,
    latestMs: samples.at(-1) ?? null,
    medianMs: median(samples),
    spreadMs: sampleSpread,
    serverTime: last?.serverTime ?? null,
    serverRequest: last?.serverRequest ?? null,
    measuredAt: new Date().toISOString()
  };
  set('tm-latest-rtt', formatMs(state.latency.latestMs));
  set('tm-median-rtt', formatMs(state.latency.medianMs));
  set('tm-spread', formatMs(state.latency.spreadMs));
  set('tm-success', `${state.latency.successfulSamples} of 3`);
}

async function updateGeolocationPermission() {
  if (!navigator.permissions?.query) {
    state.geolocationPermission = 'unknown';
  } else {
    try {
      const status = await navigator.permissions.query({ name: 'geolocation' });
      state.geolocationPermission = status.state;
      status.addEventListener?.('change', () => {
        state.geolocationPermission = status.state;
        set('ln-geo-permission', status.state);
        updateAllData();
      });
    } catch {
      state.geolocationPermission = 'unknown';
    }
  }
  set('ln-geo-permission', state.geolocationPermission);
}

function buildAllData({ includeApiReturnedDetails = true } = {}) {
  return {
    generatedAt: new Date().toISOString(),
    application: 'Robo Network Finder',
    standaloneMode: {
      deploymentMode: isStaticDeployment ? 'static GitHub Pages' : 'self-hosted API',
      githubPagesHost: isGitHubPagesHost,
      serverApiAvailable: hasServerApi,
      configuredApiBase: configuredApiBase || null,
      publicIpApiConfigured: hasPublicIpApi,
      publicIpApiEndpoint: configuredPublicIpEndpoint || null,
      remoteIpServicesUsed: state.publicProfile?.sourceType === 'public-ip-api',
      remoteGeoIpServicesUsed: false,
      remoteStunOrTurnUsed: false,
      localIpDataRequiredForIspOrIpLocation: true,
      localIpDataFile: state.publicProfile?.offlineIpData?.file ?? 'ip-data.local.json',
      endpoints: hasServerApi ? [
        apiUrl('/api/network/profile'),
        apiUrl('/api/network/ipv4'),
        apiUrl('/api/network/ipv6'),
        apiUrl('/api/network/ping')
      ] : (hasPublicIpApi ? [configuredPublicIpEndpoint] : [])
    },
    browserNetwork: state.browserNetwork ?? collectBrowserNetwork(),
    serverObservedPublicAddress: state.publicProfile ?? {
      status: state.publicProfileError ? 'unavailable' : 'checking',
      error: state.publicProfileError
    },
    apiReturnedAllDetails: includeApiReturnedDetails ? (state.publicProfile?.apiAllDetails ?? null) : null,
    explicitPublicAddressChecks: state.familyChecks,
    sameOriginLatency: state.latency,
    optionalLocalNetworkCandidates: state.localCandidates,
    optionalPreciseBrowserLocation: state.preciseLocation,
    geolocationPermission: state.geolocationPermission
  };
}

function updateAllData() {
  const output = $('json-output');
  if (output) output.textContent = JSON.stringify(buildAllData(), null, 2);
}

async function copyAllData() {
  const text = JSON.stringify(buildAllData(), null, 2);
  const button = $('json-copy');
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    button.textContent = copied ? 'Copied' : 'Copy Failed';
  }
  window.setTimeout(() => { button.textContent = 'Copy'; }, 1_200);
}

function downloadAllData() {
  const text = JSON.stringify(buildAllData(), null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `robo-network-finder-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

bindUpdate('upd-network', refreshNetwork);
bindUpdate('upd-ip', refreshPublicProfile);
bindRequest('btn-ipv4', () => requestPublicFamily('IPv4'));
bindRequest('btn-ipv6', () => requestPublicFamily('IPv6'));
bindRequest('btn-webrtc', requestLocalCandidates);
bindRequest('btn-lan-ipv4', requestLocalCandidates);
bindRequest('btn-lan-ipv6', requestLocalCandidates);
bindRequest('btn-lan-mdns', requestLocalCandidates);
bindRequest('btn-geo', requestPreciseLocation);
bindRequest('btn-geo-local', requestPreciseLocation);
bindRequest('btn-latency', requestLatency);
$('json-copy').addEventListener('click', copyAllData);
$('json-download').addEventListener('click', downloadAllData);

window.addEventListener('online', refreshNetwork);
window.addEventListener('offline', refreshNetwork);
getConnection()?.addEventListener?.('change', refreshNetwork);

try {
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const applyTheme = (isDark) => root.classList.toggle('dark', isDark);
  applyTheme(media.matches);
  media.addEventListener?.('change', (event) => applyTheme(event.matches));
} catch {
  // Theme detection is cosmetic and must not interrupt diagnostics.
}

refreshNetwork();
updateGeolocationPermission().then(updateAllData);
refreshPublicProfile();
