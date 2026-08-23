// This file is copied to the GitHub Pages artifact as runtime-config.js.
// Keep static mode for GitHub Pages. The public IP buttons use the Robo IP API
// below; that API must return Access-Control-Allow-Origin: * (or this Pages
// origin). Set mode to 'api' plus apiBase for the full self-hosted dashboard API.
window.ROBO_NETWORK_CONFIG = Object.freeze({
  mode: 'static', // 'static' | 'api'
  apiBase: '',
  publicIpEndpoint: 'https://apis.robo-universe.com/ipdata'
});
