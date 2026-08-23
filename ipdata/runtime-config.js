// Default runtime configuration. Local Node use remains automatic on localhost.
// Public/custom-domain deployments use the Cloudflare Worker for real IP data.
window.ROBO_NETWORK_CONFIG = Object.freeze({
  mode: 'auto', // local Node on localhost; static Worker mode on public hosts
  apiBase: '',
  publicIpEndpoint: 'https://ipdata.swartzlander.workers.dev/ipdata'
});
