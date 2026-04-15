const test = require('node:test');
const assert = require('node:assert/strict');
const { AlertManager } = require('../lib/alerts.js');
const { Storage } = require('../lib/storage.js');

function mkConfig(overrides = []) {
  return {
    ntfy: { url: 'https://ntfy.sh/fake', firingPriority: 'high', resolvedPriority: 'default', firingTags: ['warning'], resolvedTags: ['white_check_mark'] },
    defaults: { cpuPct: 90, memPct: 90, diskPct: 90, forMs: 60_000, reachability: true },
    overrides,
  };
}

test('AlertManager.resolveRule: guest override beats machine override beats defaults', () => {
  const mgr = new AlertManager({
    config: mkConfig([
      { machine: 'a',                       cpuPct: 80 },
      { machine: 'a', guest: 'g1', cpuPct: 70 },
    ]),
    storage: new Storage(':memory:'),
    fetch: async () => ({ ok: true }),
  });
  assert.equal(mgr.resolveRule('a', null).cpuPct, 80, 'machine-level override applies to host');
  assert.equal(mgr.resolveRule('a', 'g1').cpuPct, 70, 'guest override wins');
  assert.equal(mgr.resolveRule('a', 'g2').cpuPct, 80, 'fallback to machine override');
  assert.equal(mgr.resolveRule('b', null).cpuPct, 90, 'fallback to defaults');
  // Non-overridden fields come from defaults
  assert.equal(mgr.resolveRule('a', 'g1').memPct, 90);
});

function mkState(machine, host) {
  return { lastPoll: null, globalStatus: 'up', machines: { [machine]: { type: 'proxmox', status: 'up', host, guests: [] } } };
}

test('AlertManager.evaluate: cpu ok→pending→firing→resolved with forMs gate', async () => {
  const calls = [];
  const storage = new Storage(':memory:');
  const mgr = new AlertManager({
    config: mkConfig(),
    storage,
    fetch: async (url, opts) => { calls.push({ url, opts }); return { ok: true }; },
  });
  const hot = { cpuPct: 95, memUsed: 0, memTotal: 100, diskUsed: 0, diskTotal: 100 };
  const cold = { cpuPct: 10, memUsed: 0, memTotal: 100, diskUsed: 0, diskTotal: 100 };

  // t=0: cpu hot, ok→pending, no POST
  await mgr.evaluate(mkState('m', hot), 0);
  assert.equal(calls.length, 0);
  // t=30s: still hot, still pending
  await mgr.evaluate(mkState('m', hot), 30_000);
  assert.equal(calls.length, 0);
  // t=60s: forMs elapsed, pending→firing, POST
  await mgr.evaluate(mkState('m', hot), 60_000);
  assert.equal(calls.length, 1);
  assert.match(calls[0].opts.headers.Title, /FIRING.*m.*cpu/);
  assert.equal(calls[0].opts.headers.Priority, 'high');
  // t=70s: still firing, no new POST
  await mgr.evaluate(mkState('m', hot), 70_000);
  assert.equal(calls.length, 1);
  // t=80s: cool, firing→ok, resolved POST
  await mgr.evaluate(mkState('m', cold), 80_000);
  assert.equal(calls.length, 2);
  assert.match(calls[1].opts.headers.Title, /OK.*m.*cpu/);
  assert.equal(calls[1].opts.headers.Priority, 'default');
  storage.close();
});

test('AlertManager.evaluate: condition flaps below forMs → no notification', async () => {
  const calls = [];
  const storage = new Storage(':memory:');
  const mgr = new AlertManager({
    config: mkConfig(),
    storage,
    fetch: async (url, opts) => { calls.push({ url, opts }); return { ok: true }; },
  });
  const hot  = { cpuPct: 95, memUsed: 0, memTotal: 100, diskUsed: 0, diskTotal: 100 };
  const cold = { cpuPct: 10, memUsed: 0, memTotal: 100, diskUsed: 0, diskTotal: 100 };
  await mgr.evaluate(mkState('m', hot),  0);
  await mgr.evaluate(mkState('m', hot),  30_000);
  await mgr.evaluate(mkState('m', cold), 40_000);
  assert.equal(calls.length, 0);
  storage.close();
});
