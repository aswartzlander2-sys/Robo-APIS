// Deployment configuration for Robo Network Finder.
// "auto" uses the same-origin Node API locally and switches to static mode on
// *.github.io. Set mode to "static" for a GitHub Pages custom domain, or set
// mode to "api" plus apiBase to use your own self-hosted dashboard API origin.
// publicIpEndpoint may be a same-origin path or a full CORS-enabled Robo IP API URL.
window.ROBO_NETWORK_CONFIG = Object.freeze({
  mode: 'auto', // 'auto' | 'static' | 'api'
  apiBase: '',  // Example: 'https://network-api.example.com'
  publicIpEndpoint: '/ipdata'
});
