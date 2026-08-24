// GitHub Pages /ipdata deployment configuration.
// The page calls its own hostname; Cloudflare routes the no-slash /ipdata API
// request to the Worker while GitHub Pages continues serving /ipdata/.
window.ROBO_NETWORK_CONFIG = Object.freeze({
  mode: 'static',
  apiBase: '',
  publicIpEndpoint: '/ipdata'
});
