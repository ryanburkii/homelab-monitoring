const KEEPALIVE_MS = 15_000;

class SseBroker {
  #clients = new Set();
  #keepaliveTimer = null;

  addClient(res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    try { res.write(': connected\n\n'); } catch { return; }
    this.#clients.add(res);
    res.on('close', () => {
      this.#clients.delete(res);
      if (this.#clients.size === 0 && this.#keepaliveTimer) {
        clearInterval(this.#keepaliveTimer);
        this.#keepaliveTimer = null;
      }
    });
    if (!this.#keepaliveTimer) {
      this.#keepaliveTimer = setInterval(() => this.#keepalive(), KEEPALIVE_MS);
      this.#keepaliveTimer.unref?.();
    }
  }

  broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.#clients) {
      try { res.write(payload); } catch {
        this.#clients.delete(res);
      }
    }
  }

  clientCount() {
    return this.#clients.size;
  }

  stop() {
    if (this.#keepaliveTimer) {
      clearInterval(this.#keepaliveTimer);
      this.#keepaliveTimer = null;
    }
    for (const res of this.#clients) {
      try { res.end(); } catch {}
    }
    this.#clients.clear();
  }

  #keepalive() {
    for (const res of this.#clients) {
      try { res.write(': keepalive\n\n'); } catch {
        this.#clients.delete(res);
      }
    }
  }
}

module.exports = { SseBroker, KEEPALIVE_MS };
