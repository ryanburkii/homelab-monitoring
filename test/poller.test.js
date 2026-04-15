const test = require('node:test');
const assert = require('node:assert/strict');
const { Poller } = require('../lib/poller.js');

const baseConfig = {
  server: { pollIntervalMs: 10_000, serviceTimeoutMs: 2_000 },
  machines: [
    { name: 'nas', type: 'node_exporter', host: '127.0.0.1', port: 9100 },
  ],
  services: [],
};

test('Poller: getState returns skeleton before first tick', () => {
  const poller = new Poller(baseConfig, { scrapers: {}, servicePing: async () => {} });
  const state = poller.getState();
  assert.equal(state.lastPoll, null);
  assert.equal(state.globalStatus, 'down');
  assert.equal(state.machines.nas.status, 'down');
  assert.equal(state.machines.nas.host, null);
  assert.deepEqual(state.services, []);
});

test('Poller.tick: dispatches by type and populates state', async () => {
  const mockNodeExporterResult = {
    memTotal: 1000, memAvailable: 400,
    diskTotal: 2000, diskAvailable: 800,
    netRxBytes: 100, netTxBytes: 50,
    cpuIdleSeconds: 90, cpuTotalSeconds: 100,
    bootTimeSeconds: Math.floor(Date.now() / 1000) - 3600,
    loadavg: [0.1, 0.2, 0.3],
  };
  const poller = new Poller(baseConfig, {
    scrapers: {
      node_exporter: async () => mockNodeExporterResult,
    },
    servicePing: async () => ({ status: 'up', responseTime: 10 }),
  });
  await poller.tick();
  const state = poller.getState();
  assert.ok(state.lastPoll);
  assert.equal(state.machines.nas.status, 'up');
  assert.equal(state.machines.nas.host.memUsed, 600);
  assert.equal(state.machines.nas.host.memTotal, 1000);
  assert.equal(state.machines.nas.host.diskUsed, 1200);
  assert.equal(state.machines.nas.host.diskTotal, 2000);
  assert.equal(state.machines.nas.host.netRx, null);
  assert.equal(state.machines.nas.host.netTx, null);
  assert.equal(state.machines.nas.host.cpuPct, null);
  assert.ok(state.machines.nas.host.uptime >= 3600);
  assert.deepEqual(state.machines.nas.host.loadavg, [0.1, 0.2, 0.3]);
});

test('Poller.tick: computes network rates between consecutive ticks', async () => {
  let callCount = 0;
  const bootTime = Math.floor(Date.now() / 1000) - 3600;
  const samples = [
    { memTotal: 1000, memAvailable: 400, diskTotal: 2000, diskAvailable: 800,
      netRxBytes: 1000, netTxBytes: 500,
      cpuIdleSeconds: 900, cpuTotalSeconds: 1000,
      bootTimeSeconds: bootTime, loadavg: [0,0,0] },
    { memTotal: 1000, memAvailable: 400, diskTotal: 2000, diskAvailable: 800,
      netRxBytes: 11000, netTxBytes: 5500,
      cpuIdleSeconds: 905, cpuTotalSeconds: 1010,
      bootTimeSeconds: bootTime, loadavg: [0,0,0] },
  ];
  const poller = new Poller(baseConfig, {
    scrapers: { node_exporter: async () => samples[callCount++] },
    servicePing: async () => ({ status: 'up', responseTime: 10 }),
  });
  await poller.tick();
  await new Promise((r) => setTimeout(r, 100));
  await poller.tick();
  const host = poller.getState().machines.nas.host;
  assert.ok(host.netRx > 0, `expected netRx > 0, got ${host.netRx}`);
  assert.ok(host.netTx > 0, `expected netTx > 0, got ${host.netTx}`);
  assert.equal(host.cpuPct.toFixed(0), '50');
});
