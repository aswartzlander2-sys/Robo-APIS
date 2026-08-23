# Robo Network Finder

A self-hosted, standalone IP and network detector in **one folder**. It keeps the Robo detector’s card/grid treatment, Robo logo, Helvetica stack, request-button styling, responsive behavior, and **All Details (JSON)** panel—while collecting only network-focused data.

The detector now has three times the original network surface: six information cards plus the full JSON report.

## No third-party network services

At runtime the browser calls only this app’s own endpoints:

```text
/api/network/profile
/api/network/ipv4
/api/network/ipv6
/api/network/ping
```

It does **not** call an IP lookup service, GeoIP API, CDN, external font, remote logo, analytics provider, STUN/TURN server, or DNS/WHOIS service.

## What the page shows

### Network

- Online state, connection type, effective type, downlink, RTT, Data Saver, page protocol, host, and secure-context state
- Public address observed by this server
- Explicit blue **Click to Request** controls for public IPv4 and public IPv6 observations
- Optional host-only WebRTC local candidate collection

### IP Geolocation / address data

- Current address family, public/private/special scope, and observed-via source
- Local offline database status, file, match state, and CIDR
- Country, region, city, ISP, ASN, timezone, and coordinates when a local database record exists
- Browser-permission GPS request button

### Transport, timing, and diagnostics

- Browser network API support, HTTP protocol, navigation type, security, transfer sizes, browser locale/timezone, resource count
- DNS/TCP/TLS/request/TTFB/DOM/load timing from the page navigation
- Three-sample, same-origin server round-trip diagnostic via a blue **Click to Request** button

### Local network / location

- WebRTC support
- Separate blue request buttons for local IPv4, IPv6, mDNS, and all host candidates
- Candidate counts by family
- Geolocation API and permission state
- Optional precise GPS capture

### All Details (JSON)

The bottom panel includes all data above plus raw same-origin endpoint results, family-check status, latency samples, local candidate data, and optional GPS data. It can be copied or downloaded locally.

## Public IPv4 and IPv6 behavior

The green **Update** control captures the public address family used by the current request. The separate blue IPv4/IPv6 buttons make a fresh same-origin request and show whether that request arrived over the requested family.

A single hostname cannot force a browser to use both address families. If one row says `not observed`, that does not mean the device lacks that protocol—it means this particular same-origin request did not arrive over it. To test both paths independently, deploy this same app on your own A-only hostname and your own AAAA-only hostname, then open each hostname separately.

The local WebRTC request controls can additionally reveal browser-exposed local IPv4/IPv6/mDNS host candidates, without using a STUN/TURN server or probing LAN hosts.

## Offline ISP and IP-location data

An IP address does not inherently contain its ISP, ASN, city, or coordinates. Those details require a database. To remain independent, this project does not download or query one.

To populate those rows, add your own local IPv4 CIDR file named `ip-data.local.json` in this same folder:

1. Copy `ip-data.local.example.json` to `ip-data.local.json`.
2. Add records from a licensed/offline dataset you control.
3. Reload the page or press Public IP **Update**.

Example schema:

```json
{
  "records": [
    {
      "cidr": "203.0.113.0/24",
      "country": "Example Country",
      "countryCode": "EX",
      "region": "Example Region",
      "city": "Example City",
      "postal": "00000",
      "latitude": 0,
      "longitude": 0,
      "isp": "Example ISP",
      "organisation": "Example Organization",
      "asn": "AS64500",
      "timezone": "Etc/UTC"
    }
  ]
}
```

The server selects the most-specific matching IPv4 prefix. The local data file is never served to the browser or sent anywhere.

## Run

Requires Node.js 20+.

```bash
cd robo-network-finder
npm start
```

Open [http://localhost:3000](http://localhost:3000). No `npm install` is needed.

Run tests:

```bash
npm test
```

## Proxy setup

For a direct Node deployment:

```bash
TRUST_PROXY=false npm start
```

Behind a trusted proxy that strips caller-supplied `X-Forwarded-For` and adds its own:

```bash
TRUST_PROXY=true npm start
```

## Public third-party IP API

When `server.js` is deployed behind `apis.robo-universe.com`, it exposes a CORS-enabled public IP echo endpoint for other Robo services:

```text
GET https://apis.robo-universe.com/ipdata
GET https://apis.robo-universe.com/ipdata?format=plain
GET https://apis.robo-universe.com/ipdata/health
```

It returns only the current caller’s observed address, accepts no target-IP query parameter, and defaults to 120 requests per minute per transient hashed caller address. The public endpoint has `Access-Control-Allow-Origin: *` so browser-based Robo services can call it directly. The older `/api/v1/ip` path remains a compatibility alias.

See [`API.md`](API.md) for response examples, fetch snippets, reverse-proxy requirements, rate-limit behavior, and deployment configuration.

## GitHub Pages deployment

GitHub Pages can host the detector UI, but it cannot run `server.js` or any Node API route. The included workflow builds a safe static artifact containing only the browser files:

```text
index.html
app.js
styles.css
tailwind.css
robo-logo.png
runtime-config.js
```

It intentionally does **not** deploy `server.js`, `network-utils.js`, tests, or a local `ip-data.local.json` file.

### Deploy

1. Push this folder to a GitHub repository.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, select **GitHub Actions**.
4. Push to `main` or `master`, or run **Deploy Robo Network Finder to GitHub Pages** from the Actions tab.

The workflow at `.github/workflows/deploy-pages.yml` deploys the static artifact automatically.

### Static Pages behavior

The generated Pages site uses `github-pages-config.js`, which sets `mode: 'static'` and configures `https://apis.robo-universe.com/ipdata` for explicit public-IP checks. Browser-native fields, local candidate buttons, GPS, timing, JSON export, and the visual UI all work. The public IP and requested IPv4/IPv6 fields can use that Robo endpoint; server RTT, ISP, ASN, and IP geolocation still require the full self-hosted dashboard API because GitHub Pages has no server process or local IP database.

To retain those detailed server-powered fields, deploy this project’s Node server separately on infrastructure you control, then edit `github-pages-config.js`:

```js
window.ROBO_NETWORK_CONFIG = Object.freeze({
  mode: 'api',
  apiBase: 'https://your-network-api.example.com',
  publicIpEndpoint: 'https://apis.robo-universe.com/ipdata'
});
```

That API must allow CORS from your GitHub Pages origin. When using this project’s Node server as that API, start it with an explicit allowed origin:

```bash
ALLOWED_ORIGINS=https://your-account.github.io TRUST_PROXY=true npm start
```

This is the only way to obtain a visitor public IP from a static page without using a third-party lookup service.

## One-folder layout

```text
robo-network-finder/
├── index.html
├── app.js
├── styles.css
├── tailwind.css
├── robo-logo.png
├── runtime-config.js              # local/self-hosted runtime mode
├── github-pages-config.js         # static Pages runtime mode
├── server.js
├── network-utils.js
├── server.test.js
├── ip-data.local.example.json
├── package.json
├── .env.example
├── Caddyfile.example              # optional apis.robo-universe.com proxy config
├── .nojekyll
├── .gitignore
├── README.md
├── API.md
├── LICENSE
└── .github/workflows/deploy-pages.yml  # GitHub-required deployment config
```

## Scope and privacy

- No analytics, database, request logger, third-party IP/geolocation provider, remote logo, CDN, or external font. GitHub Pages public-IP checks may explicitly call the first-party Robo endpoint at `apis.robo-universe.com/ipdata`.
- No port scan, LAN host probing, device enumeration, router inspection, or Wi-Fi credential collection.
- Local candidate and precise location buttons are explicit browser actions.
- GPS data stays in the page and is not posted to the server.

## License

MIT — see [`LICENSE`](LICENSE).
