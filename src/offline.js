'use strict';

// Application-owned Node contexts have no socket, DNS, or fetch capability.
// Electron IPC and worker MessagePorts are OS IPC, not TCP/UDP listeners.
function denyNetwork() {
  const denied = () => { throw new Error('Network access is disabled: this is an offline application.'); };
  const net = require('node:net');
  net.Socket.prototype.connect = denied;
  net.Server.prototype.listen = denied;
  for (const moduleName of ['node:http', 'node:https']) {
    const mod = require(moduleName);
    mod.request = mod.get = mod.createServer = denied;
  }
  const tls = require('node:tls'); tls.connect = tls.createServer = denied;
  require('node:dgram').createSocket = denied;
  const dns = require('node:dns');
  for (const key of Object.keys(dns)) if (/^(resolve|lookup|reverse)/.test(key)) dns[key] = denied;
  for (const key of Object.keys(dns.promises)) if (/^(resolve|lookup|reverse)/.test(key)) dns.promises[key] = denied;
  globalThis.fetch = denied;
  globalThis.WebSocket = class { constructor() { denied(); } };
}
module.exports = { denyNetwork };
