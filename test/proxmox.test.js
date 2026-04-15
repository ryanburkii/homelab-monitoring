const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseClusterResources } = require('../lib/proxmox.js');

const clusterFixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures/proxmox-cluster-resources.json'), 'utf8'));

test('parseClusterResources: extracts host stats for matching node', () => {
  const { host } = parseClusterResources(clusterFixture.data, 'proxmox-dmz');
  assert.equal(host.cpuPct.toFixed(1), '14.3');
  assert.equal(host.memUsed, 8589934592);
  assert.equal(host.memTotal, 34359738368);
  assert.equal(host.diskUsed, 214748364800);
  assert.equal(host.diskTotal, 1099511627776);
  assert.equal(host.uptime, 864000);
  assert.equal(host._cumulative.netRxBytes, 1048576000);
  assert.equal(host._cumulative.netTxBytes, 524288000);
});

test('parseClusterResources: throws when node not found', () => {
  assert.throws(
    () => parseClusterResources(clusterFixture.data, 'nonexistent'),
    /node not found/,
  );
});
