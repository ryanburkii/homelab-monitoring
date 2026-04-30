const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { SseBroker } = require('../lib/sse_broker.js');

function fakeRes() {
  const ee = new EventEmitter();
  const writes = [];
  return {
    writes,
    writeHead(_status, _headers) {},
    write(chunk) { writes.push(String(chunk)); return true; },
    end() { ee.emit('close'); },
    on(ev, fn) { ee.on(ev, fn); },
    _emit: (ev) => ee.emit(ev),
    _failNext: false,
  };
}

test('SseBroker: addClient writes headers preamble', () => {
  const b = new SseBroker();
  const r = fakeRes();
  b.addClient(r);
  assert.equal(r.writes.some((w) => w.includes(': connected')), true);
  assert.equal(b.clientCount(), 1);
  b.stop();
});

test('SseBroker: broadcast fans out to all clients', () => {
  const b = new SseBroker();
  const r1 = fakeRes();
  const r2 = fakeRes();
  b.addClient(r1);
  b.addClient(r2);
  b.broadcast('state', { foo: 1 });
  for (const r of [r1, r2]) {
    const evt = r.writes.find((w) => w.startsWith('event: state'));
    assert.ok(evt, 'received state event');
    assert.ok(evt.includes('"foo":1'));
  }
  b.stop();
});

test('SseBroker: removes client on close', () => {
  const b = new SseBroker();
  const r = fakeRes();
  b.addClient(r);
  assert.equal(b.clientCount(), 1);
  r._emit('close');
  assert.equal(b.clientCount(), 0);
  b.stop();
});

test('SseBroker: drops client whose write throws during broadcast', () => {
  const b = new SseBroker();
  const good = fakeRes();
  let writesBeforeBreak = 0;
  const bad = {
    writeHead() {},
    write() {
      writesBeforeBreak++;
      if (writesBeforeBreak > 1) throw new Error('socket dead');
    },
    on() {},
  };
  b.addClient(good);
  b.addClient(bad);
  assert.equal(b.clientCount(), 2);
  b.broadcast('state', { x: 1 });
  assert.equal(b.clientCount(), 1);
  b.stop();
});

test('SseBroker: refuses client whose initial write throws', () => {
  const b = new SseBroker();
  const dead = {
    writeHead() {},
    write() { throw new Error('already closed'); },
    on() {},
  };
  b.addClient(dead);
  assert.equal(b.clientCount(), 0);
  b.stop();
});
