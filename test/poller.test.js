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

test('Poller.tick: one scraper failing does not affect others', async () => {
  const config = {
    server: { pollIntervalMs: 10_000, serviceTimeoutMs: 2_000 },
    machines: [
      { name: 'nas',  type: 'node_exporter', host: '1', port: 9100 },
      { name: 'bad',  type: 'node_exporter', host: '2', port: 9100 },
    ],
    services: [],
  };
  const good = {
    memTotal: 1000, memAvailable: 400, diskTotal: 2000, diskAvailable: 800,
    netRxBytes: 0, netTxBytes: 0, cpuIdleSeconds: 0, cpuTotalSeconds: 0,
    bootTimeSeconds: Math.floor(Date.now()/1000) - 1, loadavg: [0,0,0],
  };
  const poller = new Poller(config, {
    scrapers: {
      node_exporter: async (entry) => {
        if (entry.name === 'bad') throw new Error('boom');
        return good;
      },
    },
    servicePing: async () => ({ status: 'up', responseTime: 10 }),
  });
  await poller.tick();
  const state = poller.getState();
  assert.equal(state.machines.nas.status, 'up');
  assert.equal(state.machines.bad.status, 'down');
  assert.match(state.machines.bad.error, /boom/);
});

test('Poller.tick: applies proxmox scrape result (pre-computed cpuPct + rate-derived net)', async () => {
  const config = {
    server: { pollIntervalMs: 10_000, serviceTimeoutMs: 2_000 },
    machines: [
      { name: 'proxmox-dmz', type: 'proxmox', host: '1', port: 8006, tokenId: 't', tokenSecret: 's' },
    ],
    services: [
      { name: 'Plex', machine: 'proxmox-dmz', url: 'http://example/', icon: 'plex.svg' },
    ],
  };
  const bootTime = Math.floor(Date.now() / 1000) - 3600;
  const scraped = {
    host: {
      cpuPct: 14.3, memUsed: 800, memTotal: 1000, diskUsed: 100, diskTotal: 200,
      uptime: 3600, loadavg: [0.1, 0.2, 0.3],
      _cumulative: { netRxBytes: 10000, netTxBytes: 5000 },
    },
    guests: [
      { vmid: 101, name: 'mc-server', type: 'lxc', status: 'running',
        cpuPct: 22.5, memUsed: 400, memTotal: 500, diskUsed: 10, diskTotal: 20, uptime: 100,
        _cumulative: { netRxBytes: 2000, netTxBytes: 1000 } },
    ],
  };
  const pings = [];
  const poller = new Poller(config, {
    scrapers: { proxmox: async () => scraped },
    servicePing: async (svc) => { pings.push(svc.name); return { status: 'up', responseTime: 42 }; },
  });
  await poller.tick();
  const state = poller.getState();
  assert.equal(state.machines['proxmox-dmz'].status, 'up');
  assert.equal(state.machines['proxmox-dmz'].host.cpuPct, 14.3);
  assert.equal(state.machines['proxmox-dmz'].host.memUsed, 800);
  assert.equal(state.machines['proxmox-dmz'].host.netRx, null);
  assert.equal(state.machines['proxmox-dmz'].guests.length, 1);
  assert.equal(state.machines['proxmox-dmz'].guests[0].name, 'mc-server');
  assert.equal(state.machines['proxmox-dmz'].guests[0].netRx, null);
  assert.equal(state.machines['proxmox-dmz'].guests[0].netTx, null);
  assert.equal(state.machines['proxmox-dmz'].guests[0]._cumulative, undefined);
  assert.equal(pings[0], 'Plex');
  assert.equal(state.services[0].status, 'up');
  assert.equal(state.services[0].responseTime, 42);
  assert.equal(state.globalStatus, 'up');
});

test('Poller.tick: computes per-guest network rates across consecutive ticks', async () => {
  const config = {
    server: { pollIntervalMs: 10_000, serviceTimeoutMs: 2_000 },
    machines: [
      { name: 'proxmox-dmz', type: 'proxmox', host: '1', port: 8006, tokenId: 't', tokenSecret: 's' },
    ],
    services: [],
  };
  let callCount = 0;
  const samples = [
    {
      host: { cpuPct: 10, memUsed: 100, memTotal: 1000, diskUsed: 50, diskTotal: 500,
              uptime: 100, loadavg: [0,0,0],
              _cumulative: { netRxBytes: 0, netTxBytes: 0 } },
      guests: [
        { vmid: 101, name: 'mc-server', type: 'lxc', status: 'running',
          cpuPct: 20, memUsed: 200, memTotal: 400, diskUsed: 5, diskTotal: 20, uptime: 50,
          _cumulative: { netRxBytes: 1000, netTxBytes: 500 } },
        { vmid: 102, name: 'cs2-srv', type: 'lxc', status: 'running',
          cpuPct: 30, memUsed: 250, memTotal: 400, diskUsed: 7, diskTotal: 20, uptime: 70,
          _cumulative: { netRxBytes: 5000, netTxBytes: 2500 } },
      ],
    },
    {
      host: { cpuPct: 10, memUsed: 100, memTotal: 1000, diskUsed: 50, diskTotal: 500,
              uptime: 100, loadavg: [0,0,0],
              _cumulative: { netRxBytes: 0, netTxBytes: 0 } },
      guests: [
        { vmid: 101, name: 'mc-server', type: 'lxc', status: 'running',
          cpuPct: 22, memUsed: 200, memTotal: 400, diskUsed: 5, diskTotal: 20, uptime: 50,
          _cumulative: { netRxBytes: 11000, netTxBytes: 5500 } },
        { vmid: 102, name: 'cs2-srv', type: 'lxc', status: 'running',
          cpuPct: 32, memUsed: 250, memTotal: 400, diskUsed: 7, diskTotal: 20, uptime: 70,
          _cumulative: { netRxBytes: 25000, netTxBytes: 12500 } },
      ],
    },
  ];
  const poller = new Poller(config, {
    scrapers: { proxmox: async () => samples[callCount++] },
    servicePing: async () => ({ status: 'up', responseTime: 10 }),
  });
  await poller.tick();
  await new Promise((r) => setTimeout(r, 100));
  await poller.tick();
  const guests = poller.getState().machines['proxmox-dmz'].guests;
  const mc = guests.find((g) => g.vmid === 101);
  const cs2 = guests.find((g) => g.vmid === 102);
  assert.ok(mc.netRx > 0, `mc netRx should be > 0, got ${mc.netRx}`);
  assert.ok(mc.netTx > 0, `mc netTx should be > 0, got ${mc.netTx}`);
  assert.ok(cs2.netRx > mc.netRx, `cs2 netRx (${cs2.netRx}) should exceed mc netRx (${mc.netRx}) — bigger delta`);
  assert.equal(mc._cumulative, undefined);
  assert.equal(cs2._cumulative, undefined);
});
