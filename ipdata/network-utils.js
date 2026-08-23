import { isIP } from 'node:net';

export function normaliseIp(value) {
  if (typeof value !== 'string') return null;
  let ip = value.trim();
  if (!ip) return null;
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
  if (ip.toLowerCase().startsWith('::ffff:')) ip = ip.slice(7);
  return isIP(ip) ? ip : null;
}

function firstForwardedIp(header) {
  if (typeof header !== 'string') return null;
  return normaliseIp(header.split(',')[0] ?? '');
}

export function getClientIp(request, trustProxy = false) {
  if (trustProxy) {
    const forwarded = firstForwardedIp(request.headers['x-forwarded-for']);
    if (forwarded) return { ip: forwarded, source: 'trusted reverse proxy' };
  }

  const ip = normaliseIp(request.socket?.remoteAddress ?? '');
  return { ip, source: ip ? 'direct connection' : 'unavailable' };
}

export function classifyIp(ip) {
  const family = isIP(ip);
  if (!family) return { family: null, scope: 'unavailable', publicRoutable: false };

  if (family === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0) return { family: 'IPv4', scope: 'this network / reserved', publicRoutable: false };
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
      return { family: 'IPv4', scope: 'private LAN', publicRoutable: false };
    }
    if (a === 100 && b >= 64 && b <= 127) return { family: 'IPv4', scope: 'carrier-grade NAT', publicRoutable: false };
    if (a === 127) return { family: 'IPv4', scope: 'loopback', publicRoutable: false };
    if (a === 169 && b === 254) return { family: 'IPv4', scope: 'link-local', publicRoutable: false };
    if (a === 192 && b === 0) return { family: 'IPv4', scope: 'reserved', publicRoutable: false };
    if (a === 192 && b === 2) return { family: 'IPv4', scope: 'documentation', publicRoutable: false };
    if (a === 198 && (b === 18 || b === 19 || b === 51)) return { family: 'IPv4', scope: 'benchmark / documentation', publicRoutable: false };
    if (a === 203 && b === 0) return { family: 'IPv4', scope: 'documentation', publicRoutable: false };
    if (a >= 224) return { family: 'IPv4', scope: a <= 239 ? 'multicast' : 'reserved', publicRoutable: false };
    return { family: 'IPv4', scope: 'public', publicRoutable: true };
  }

  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return { family: 'IPv6', scope: 'unspecified / loopback', publicRoutable: false };
  if (lower.startsWith('fc') || lower.startsWith('fd')) return { family: 'IPv6', scope: 'unique local address', publicRoutable: false };
  if (/^fe[89ab]/.test(lower)) return { family: 'IPv6', scope: 'link-local', publicRoutable: false };
  if (lower.startsWith('ff')) return { family: 'IPv6', scope: 'multicast', publicRoutable: false };
  if (lower.startsWith('2001:db8')) return { family: 'IPv6', scope: 'documentation', publicRoutable: false };
  return { family: 'IPv6', scope: 'public', publicRoutable: true };
}

export function isPublicIp(ip) {
  return classifyIp(ip).publicRoutable;
}

function ipv4ToUint32(ip) {
  const octets = ip.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
  return (((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3]) >>> 0;
}

function parseIpv4Cidr(cidr) {
  if (typeof cidr !== 'string') return null;
  const [address, prefixText] = cidr.trim().split('/');
  const prefix = Number(prefixText);
  const network = ipv4ToUint32(address);
  if (network === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { network: network & mask, mask, prefix, cidr: `${address}/${prefix}` };
}

/**
 * Normalize a small, local IPv4 prefix database. No record is downloaded,
 * queried remotely, or retained outside the supplied JSON file.
 */
export function normaliseLocalRecords(value) {
  const candidates = Array.isArray(value) ? value : value?.records;
  if (!Array.isArray(candidates)) return [];

  return candidates
    .map((record) => {
      const cidr = parseIpv4Cidr(record?.cidr);
      return cidr ? { ...record, ...cidr } : null;
    })
    .filter(Boolean)
    .sort((left, right) => right.prefix - left.prefix);
}

export function lookupLocalIpRecord(ip, records) {
  if (isIP(ip) !== 4) return null;
  const target = ipv4ToUint32(ip);
  if (target === null) return null;
  return records.find((record) => (target & record.mask) === record.network) ?? null;
}
