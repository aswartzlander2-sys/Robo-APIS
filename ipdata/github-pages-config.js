// This file is copied to the GitHub Pages artifact as runtime-config.js.
// It points the static site to the separately hosted Robo IP Data API.
window.ROBO_NETWORK_CONFIG = Object.freeze({
  mode: 'static',
  apiBase: '',
  publicIpEndpoint: 'https://api.robo-universe.com/ipdata'
});
