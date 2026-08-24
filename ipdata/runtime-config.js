// GitHub Pages /ipdata deployment configuration.
// The Cloudflare Worker receives the visitor request and returns real IP data.
window.ROBO_NETWORK_CONFIG = Object.freeze({
  mode: 'static',
  apiBase: '',
  publicIpEndpoint: 'https://ipdata.swartzlander.workers.dev/ipdata'
});
