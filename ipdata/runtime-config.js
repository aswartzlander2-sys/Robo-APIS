// GitHub Pages /ipdata deployment configuration.
// GitHub Pages is static, so public IP data comes from the deployed Worker.
window.ROBO_NETWORK_CONFIG = Object.freeze({
  mode: 'static',
  apiBase: '',
  publicIpEndpoint: 'https://ipdata.swartzlander.workers.dev/ipdata'
});
