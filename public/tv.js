(function () {
  const chip = document.getElementById('tvChip');
  const dialog = document.getElementById('tvRemote');
  if (!chip || !dialog) return;

  const grid = dialog.querySelector('[data-tv-shortcuts]');
  const powerBtn = dialog.querySelector('[data-tv-power]');
  const powerLabel = dialog.querySelector('[data-tv-power-label]');
  const status = dialog.querySelector('[data-tv-status]');
  const muteBtn = dialog.querySelector('[data-tv-vol="mute"]');
  const closeBtn = dialog.querySelector('[data-tv-close]');

  let snapshot = null;
  let es = null;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function renderShortcuts(shortcuts) {
    grid.innerHTML = shortcuts.map((s) => `
      <button class="tv-shortcut" data-tv-shortcut="${escapeHtml(s.id)}" aria-current="false" type="button">
        <span class="tv-shortcut-icon">${s.icon ? `<img src="/icons/${escapeHtml(s.icon)}" alt="">` : ''}</span>
        <span class="tv-shortcut-label">${escapeHtml(s.label)}</span>
      </button>
    `).join('');
    grid.querySelectorAll('[data-tv-shortcut]').forEach((btn) => {
      btn.addEventListener('click', () => sendSource(btn.dataset.tvShortcut, btn));
    });
  }

  async function init() {
    try {
      const r = await fetch('/api/landing-config');
      if (!r.ok) return;
      const cfg = await r.json();
      if (!cfg.tv || !cfg.tv.available) return;
      renderShortcuts(cfg.tv.shortcuts || []);
      chip.hidden = false;
    } catch {}
  }

  function applySnapshot(snap) {
    if (!snap || snap.connected === false) return applyOffline();
    snapshot = snap;
    status.hidden = true;
    setEnabled(true);

    const on = !!(snap.power && snap.power.on);
    powerBtn.setAttribute('aria-pressed', String(on));
    powerLabel.textContent = on ? 'tv is on' : 'tv is off';
    chip.dataset.tvOn = on ? 'true' : 'false';

    const muted = !!(snap.volume && snap.volume.muted);
    muteBtn.setAttribute('aria-pressed', String(muted));

    dialog.querySelectorAll('[data-tv-shortcut]').forEach((btn) => {
      const sc = (snap.shortcuts || []).find((s) => s.id === btn.dataset.tvShortcut);
      btn.setAttribute('aria-current', sc && sc.active ? 'true' : 'false');
    });
  }

  function applyOffline() {
    snapshot = null;
    status.hidden = false;
    status.textContent = 'home assistant offline';
    setEnabled(false);
    powerLabel.textContent = '—';
    chip.dataset.tvOn = 'false';
  }

  function setEnabled(enabled) {
    dialog
      .querySelectorAll('[data-tv-power], [data-tv-vol], [data-tv-shortcut]')
      .forEach((b) => { b.disabled = !enabled; });
  }

  function openSheet() {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    chip.setAttribute('aria-expanded', 'true');

    fetch('/api/tv')
      .then((r) => (r.ok ? r.json() : null))
      .then((snap) => snap && applySnapshot(snap))
      .catch(() => {});

    es = new EventSource('/api/tv/stream');
    es.addEventListener('snapshot', (e) => {
      try { applySnapshot(JSON.parse(e.data)); } catch {}
    });
    es.addEventListener('offline', () => applyOffline());
  }

  function closeSheet() {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  dialog.addEventListener('close', () => {
    chip.setAttribute('aria-expanded', 'false');
    if (es) { es.close(); es = null; }
  });

  chip.addEventListener('click', openSheet);
  closeBtn.addEventListener('click', closeSheet);

  powerBtn.addEventListener('click', () => {
    const desired = snapshot && snapshot.power && snapshot.power.on ? false : true;
    postWithFeedback('/api/tv/power', { on: desired }, powerBtn);
  });

  dialog.querySelectorAll('[data-tv-vol]').forEach((btn) => {
    btn.addEventListener('click', () => {
      postWithFeedback('/api/tv/volume', { action: btn.dataset.tvVol }, btn);
    });
  });

  function sendSource(id, btn) {
    postWithFeedback('/api/tv/source', { id }, btn);
  }

  async function postWithFeedback(url, body, btn) {
    btn.setAttribute('aria-busy', 'true');
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) shakeError(btn);
    } catch {
      shakeError(btn);
    } finally {
      btn.removeAttribute('aria-busy');
    }
  }

  function shakeError(btn) {
    btn.classList.remove('tv-err');
    void btn.offsetWidth;
    btn.classList.add('tv-err');
    setTimeout(() => btn.classList.remove('tv-err'), 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
