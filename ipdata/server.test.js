import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyIp,
  getClientIp,
  lookupLocalIpRecord,
  normaliseIp,
  normaliseLocalRecords
} from './network-utils.js';

test('normaliseIp accepts regular, bracketed, and IPv4-mapped addresses', () => {
  assert.equal(normaliseIp(' 8.8.8.8 '), '8.8.8.8');
  assert.equal(normaliseIp('[2001:4860:4860::8888]'), '2001:4860:4860::8888');
  assert.equal(normaliseIp('::ffff:1.1.1.1'), '1.1.1.1');
  assert.equal(normaliseIp('not an address'), null);
});

test('getClientIp uses forwarded values only after an explicit trust decision', () => {
  const request = {
    headers: { 'x-forwarded-for': '8.8.8.8, 10.0.0.2' },
    socket: { remoteAddress: '::ffff:192.0.2.9' }
  };

  assert.deepEqual(getClientIp(request, false), {
    ip: '192.0.2.9',
    source: 'direct connection'
  });
  assert.deepEqual(getClientIp(request, true), {
    ip: '8.8.8.8',
    source: 'trusted reverse proxy'
  });
});

test('classifyIp identifies public, private, and special-address scopes', () => {
  assert.deepEqual(classifyIp('8.8.8.8'), {
    family: 'IPv4',
    scope: 'public',
    publicRoutable: true
  });
  assert.equal(classifyIp('192.168.1.10').scope, 'private LAN');
  assert.equal(classifyIp('100.64.0.1').scope, 'carrier-grade NAT');
  assert.equal(classifyIp('::1').publicRoutable, false);
  assert.equal(classifyIp('2001:4860:4860::8888').publicRoutable, true);
});

test('offline local records use the most-specific matching IPv4 prefix', () => {
  const records = normaliseLocalRecords({
    records: [
      { cidr: '8.8.0.0/16', country: 'Broad example' },
      { cidr: '8.8.8.0/24', country: 'Specific example', asn: 'AS15169' },
      { cidr: 'invalid', country: 'Ignored' }
    ]
  });

  assert.equal(records.length, 2);
  assert.equal(lookupLocalIpRecord('8.8.8.8', records).country, 'Specific example');
  assert.equal(lookupLocalIpRecord('8.8.4.4', records).country, 'Broad example');
  assert.equal(lookupLocalIpRecord('1.1.1.1', records), null);
});
