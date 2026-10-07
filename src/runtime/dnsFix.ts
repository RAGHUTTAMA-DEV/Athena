import dns from 'dns';

// Force Node.js dns.lookup to prioritize IPv4 (family: 4).
// Fixes Node 18+ undici fetch hangs and ConnectTimeoutError on Windows networks where IPv6 is unroutable.
const origLookup = dns.lookup;
(dns as any).lookup = (hostname: any, options: any, callback: any) => {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  if (typeof options === 'number') {
    options = { family: options };
  }
  const opts = { ...options, family: 4 };
  return origLookup(hostname, opts, callback);
};

try {
  dns.setDefaultResultOrder('ipv4first');
} catch (e) {}
