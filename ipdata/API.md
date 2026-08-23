# Robo Network Finder IP API

The Node service exposes a public, third-party-compatible **IP echo API** for Robo services and browser clients.

## Canonical public URL

When deployed, the public service is:

```text
https://apis.robo-universe.com/ipdata
```

It returns the public address observed for the **current caller**. It does not accept an IP address parameter, so it cannot be used to look up another target.

> GitHub Pages cannot host these endpoints. Deploy `server.js` on the Node-capable host behind `apis.robo-universe.com` and terminate HTTPS at the reverse proxy or hosting platform.

## Endpoints

| Request | Result |
| --- | --- |
| `GET https://apis.robo-universe.com/ipdata` | JSON IP response |
| `GET https://apis.robo-universe.com/ipdata?format=plain` | IP address as plain text |
| `GET https://apis.robo-universe.com/ipdata/health` | Public health/capability response |

Example JSON response:

```json
{
  "ip": "203.0.113.42",
  "version": "IPv4",
  "scope": "public",
  "isPublic": true,
  "observedAt": "2026-08-23T23:30:00.000Z",
  "service": "Robo Network Finder IP API",
  "apiVersion": "v1"
}
```

The legacy versioned paths (`/api/v1/ip` and `/api/v1/health`) remain available as compatibility aliases, but new Robo services should use `/ipdata`.

## Browser use

The IP endpoint sends `Access-Control-Allow-Origin: *`, allowing browser-based Robo services to use it directly:

```js
const response = await fetch('https://apis.robo-universe.com/ipdata');
const { ip, version } = await response.json();
console.log(ip, version);
```

For a plain-text response:

```js
const ip = await fetch('https://apis.robo-universe.com/ipdata?format=plain')
  .then((response) => response.text());
```

## Server-to-server use

```bash
curl -H 'Accept: application/json' https://apis.robo-universe.com/ipdata
curl 'https://apis.robo-universe.com/ipdata?format=plain'
```

## Deployment configuration

Configure the Node service environment:

```bash
PUBLIC_IP_API_ENABLED=true
PUBLIC_IP_API_PATH=/ipdata
PUBLIC_IP_RATE_LIMIT=120
HOST=127.0.0.1
TRUST_PROXY=true
npm start
```

`TRUST_PROXY=true` is appropriate only when the reverse proxy strips client-provided forwarding headers and provides its own trusted `X-Forwarded-For` value. Keep Node bound to `127.0.0.1` (or otherwise firewall it to the proxy) in that mode. For a direct Node deployment, use `TRUST_PROXY=false`.

### Caddy example

A ready-to-copy [`Caddyfile.example`](Caddyfile.example) is included. Its essential configuration preserves the public endpoint path as-is:

```caddy
apis.robo-universe.com {
    reverse_proxy 127.0.0.1:3000
}
```

Point the DNS record for `apis.robo-universe.com` to the proxy host and use a valid TLS certificate. DNS, certificate provisioning, and hosting deployment must be completed in the Robo infrastructure; they cannot be created from this project folder.

## Rate limit

The endpoint defaults to **120 requests per minute per caller**. Limiting is in-memory and retains only a short-lived one-way hash of the caller address.

Responses include:

```text
RateLimit-Limit
RateLimit-Remaining
RateLimit-Reset
```

A rate-limited caller receives `429 Too Many Requests` and `Retry-After`.

Set `PUBLIC_IP_API_ENABLED=false` to disable public third-party access.

## Dashboard API vs. public IP API

The existing `/api/network/*` routes remain private dashboard endpoints. They provide the Robo Network Finder’s detailed server-side profile and use same-origin access by default.

The public `/ipdata` endpoint is intentionally narrower: it returns only the requesting caller’s observed IP address and address family. It does not expose local IP data, ISP, ASN, or geolocation records.

To let a GitHub Pages frontend call the private dashboard API, set an explicit origin separately:

```bash
ALLOWED_ORIGINS=https://your-account.github.io TRUST_PROXY=true npm start
```

## Privacy and scope

- Returns only the requesting client’s observed address.
- Does not accept arbitrary target IPs.
- Does not scan ports, query WHOIS, call an external IP service, or retain a request log in the app.
- Your own reverse proxy, hosting platform, or web server may still have its own access logs; configure those separately if needed.
