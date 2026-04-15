const path = require('node:path');
const express = require('express');
const { Poller } = require('./lib/poller.js');
const proxmox = require('./lib/proxmox.js');
const nodeExporter = require('./lib/node_exporter.js');

function validateConfig(cfg) {
  const errors = [];
  if (!cfg || typeof cfg !== 'object') errors.push('config.js must export an object');
  if (!cfg.server || typeof cfg.server.port !== 'number') errors.push('server.port must be a number');
  if (!Array.isArray(cfg.machines) || cfg.machines.length === 0) errors.push('machines must be a non-empty array');
  const machineNames = new Set();
  for (const [i, m] of (cfg.machines ?? []).entries()) {
    if (!m.name) errors.push(`machines[${i}].name is required`);
    if (!['proxmox', 'node_exporter'].includes(m.type)) errors.push(`machines[${i}].type must be 'proxmox' or 'node_exporter'`);
    if (!m.host || m.host === 'REPLACE_ME') errors.push(`machines[${i}].host must be set (not REPLACE_ME)`);
    if (m.type === 'proxmox') {
      if (!m.tokenId || m.tokenId === 'REPLACE_ME') errors.push(`machines[${i}].tokenId must be set`);
      if (!m.tokenSecret || m.tokenSecret === 'REPLACE_ME') errors.push(`machines[${i}].tokenSecret must be set`);
    }
    if (m.type === 'node_exporter' && !m.port) errors.push(`machines[${i}].port required for node_exporter`);
    machineNames.add(m.name);
  }
  for (const [i, l] of (cfg.guestLinks ?? []).entries()) {
    if (!l.machine || !machineNames.has(l.machine)) errors.push(`guestLinks[${i}].machine '${l.machine}' not in machines`);
    if (!l.guest) errors.push(`guestLinks[${i}].guest is required`);
    if (!l.url) errors.push(`guestLinks[${i}].url is required`);
  }
  if (errors.length) {
    throw new Error('config.js validation failed:\n  - ' + errors.join('\n  - '));
  }
}

function main() {
  let config;
  try {
    config = require('./config.js');
    validateConfig(config);
  } catch (err) {
    console.error(`[fatal] ${err.message}`);
    process.exit(1);
  }

  const poller = new Poller(config, {
    scrapers: {
      proxmox: (entry) => proxmox.fetch({ ...entry, proxmoxTimeoutMs: config.server.proxmoxTimeoutMs }),
      node_exporter: (entry) => nodeExporter.fetch({ ...entry, nodeExporterTimeoutMs: config.server.nodeExporterTimeoutMs }),
    },
  });
  poller.start();

  const app = express();
  app.get('/api/stats', (_req, res) => res.json(poller.getState()));
  app.use(express.static(path.join(__dirname, 'public')));

  app.listen(config.server.port, () => {
    console.log(`[dashboard] listening on http://0.0.0.0:${config.server.port}`);
    console.log(`[dashboard] polling every ${config.server.pollIntervalMs}ms`);
  });
}

main();
