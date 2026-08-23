// This file is copied to the GitHub Pages artifact as runtime-config.js.
// The Worker returns the connecting visitor's real public IP with CORS enabled.
window.ROBO_NETWORK_CONFIG = Object.freeze({
  mode: 'static',
  apiBase: '',
  publicIpEndpoint: 'https://ipdata.swartzlander.workers.dev/ipdata'
});
