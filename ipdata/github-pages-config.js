// This file is copied to the GitHub Pages artifact as runtime-config.js.
// The page calls same-origin /ipdata; an exact Cloudflare Worker route handles
// that API request while GitHub Pages continues serving /ipdata/.
window.ROBO_NETWORK_CONFIG = Object.freeze({
  mode: 'static',
  apiBase: '',
  publicIpEndpoint: '/ipdata'
});
