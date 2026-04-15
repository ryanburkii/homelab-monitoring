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
