/**
 * bet_slip.js
 * Maneja el boleto de apuestas y el panel "Mis Apuestas" para todos los deportes.
 */

/* ─── MY BETS MODAL CSS (injected once) ────────────────────────────────────── */
(function injectMyBetsStyles() {
  if (document.getElementById('my-bets-styles')) return;
  const style = document.createElement('style');
  style.id = 'my-bets-styles';
  style.textContent = `
    /* My Bets Floating Button */
    #my-bets-fab {
      position: fixed;
      bottom: 20px; right: 18px;
      z-index: 150;
      background: var(--sport-clr, #6366f1);
      color: #fff;
      border: none;
      border-radius: 50px;
      padding: 11px 18px;
      font-size: .78rem; font-weight: 700;
      letter-spacing: .5px;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(0,0,0,.4);
      transition: transform .2s, filter .2s;
      display: flex; align-items: center; gap: 7px;
    }
    #my-bets-fab:hover { transform: scale(1.05); filter: brightness(1.15); }
    #my-bets-fab .fab-badge {
      background: #fff;
      color: var(--sport-clr, #6366f1);
      border-radius: 50%;
      width: 18px; height: 18px;
      font-size: .65rem; font-weight: 900;
      display: flex; align-items: center; justify-content: center;
    }

    /* My Bets Overlay */
    #my-bets-overlay {
      position: fixed; inset: 0; z-index: 400;
      background: rgba(0,0,0,.6);
      backdrop-filter: blur(4px);
      opacity: 0; pointer-events: none;
      transition: opacity .3s;
    }
    #my-bets-overlay.open { opacity: 1; pointer-events: all; }

    /* My Bets Panel */
    #my-bets-panel {
      position: fixed;
      bottom: 0; left: 0; right: 0;
      z-index: 500;
      max-height: 80vh;
      background: #0e1018;
      border-top: 1px solid rgba(255,255,255,.1);
      border-radius: 20px 20px 0 0;
      padding: 0 0 24px;
      transform: translateY(100%);
      transition: transform .35s cubic-bezier(.34,1.3,.64,1);
      display: flex; flex-direction: column;
    }
    #my-bets-panel.open { transform: translateY(0); }

    .my-bets-handle {
      width: 40px; height: 4px;
      background: rgba(255,255,255,.15);
      border-radius: 2px;
      margin: 12px auto 0;
      flex-shrink: 0;
    }
    .my-bets-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 20px 12px;
      border-bottom: 1px solid rgba(255,255,255,.08);
      flex-shrink: 0;
    }
    .my-bets-title {
      font-family: 'Orbitron', monospace;
      font-size: .8rem; font-weight: 700; letter-spacing: 1px;
    }
    .my-bets-close {
      width: 30px; height: 30px; border-radius: 50%;
      background: rgba(255,255,255,.08); border: none;
      color: #fff; font-size: 16px; cursor: pointer;
    }
    .my-bets-body {
      overflow-y: auto;
      padding: 16px 16px 0;
      flex: 1;
    }
    .my-bets-body::-webkit-scrollbar { width: 4px; }
    .my-bets-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,.1); border-radius: 2px; }

    /* Bet Card */
    .bet-card {
      background: linear-gradient(145deg, rgba(255,255,255,.05), rgba(255,255,255,.02));
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 14px;
      padding: 14px 16px;
      margin-bottom: 10px;
    }
    .bet-card-top {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 8px;
    }
    .bet-card-match {
      font-weight: 700; font-size: .82rem;
      color: rgba(255,255,255,.9);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      max-width: 65%;
    }
    .bet-card-status {
      font-size: .65rem; font-weight: 700; letter-spacing: 1px;
      border-radius: 20px; padding: 3px 10px; text-transform: uppercase;
    }
    .bet-card-status.pending  { background: rgba(251,191,36,.15); color: #fbbf24; }
    .bet-card-status.won      { background: rgba(16,185,129,.15); color: #10b981; }
    .bet-card-status.lost     { background: rgba(239,68,68,.15);  color: #ef4444; }
    .bet-card-details {
      display: flex; gap: 8px; flex-wrap: wrap;
    }
    .bet-card-chip {
      font-size: .7rem; color: rgba(255,255,255,.45);
      background: rgba(255,255,255,.05);
      border-radius: 6px; padding: 4px 8px;
    }
    .bet-card-chip strong { color: rgba(255,255,255,.8); }
    .bet-card-choice {
      font-size: .7rem; font-weight: 700;
      color: var(--sport-clr, #6366f1);
      background: color-mix(in srgb, var(--sport-clr, #6366f1) 12%, transparent);
      border-radius: 6px; padding: 4px 10px;
    }

    .my-bets-empty {
      text-align: center; padding: 40px 20px;
      color: rgba(255,255,255,.3);
      font-size: .85rem; line-height: 1.7;
    }
    .my-bets-empty .empty-icon { font-size: 2.5rem; margin-bottom: 12px; }
  `;
  document.head.appendChild(style);
})();

/* ─── BET SLIP ──────────────────────────────────────────────────────────────── */
const BetSlipAPI = {
  currentMatchId: null,
  currentTeamChoice: null,
  currentMatchName: null,
  currentOdd: null,

  open(matchId, teamChoice, matchName, odd) {
    this.currentMatchId = matchId;
    this.currentTeamChoice = teamChoice;
    this.currentMatchName = matchName;
    this.currentOdd = parseFloat(odd);

    const infoEl = document.getElementById('betslip-info');
    if (infoEl) {
      infoEl.innerHTML = `Partido: <strong>${matchName}</strong><br>Selección: <strong>${teamChoice}</strong><br>Cuota (Odd): <strong>${odd}</strong>`;
    }

    const modal = document.getElementById('betslip');
    if (modal) modal.classList.add('open');
    // Hide FAB while bet slip is open
    const fab = document.getElementById('my-bets-fab');
    if (fab) fab.style.display = 'none';
  },

  close() {
    this.currentMatchId = null;
    this.currentTeamChoice = null;
    this.currentMatchName = null;
    this.currentOdd = null;

    const modal = document.getElementById('betslip');
    if (modal) modal.classList.remove('open');
    // Restore FAB
    const fab = document.getElementById('my-bets-fab');
    if (fab) fab.style.display = '';

    const amountEl = document.getElementById('bet-amount');
    if (amountEl) amountEl.value = '';
  },

  showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `sm-toast show ${type}`;
    setTimeout(() => toast.classList.remove('show'), 3000);
  },

  async submit() {
    if (!this.currentMatchId) return;

    const amountEl = document.getElementById('bet-amount');
    if (!amountEl || !amountEl.value || parseInt(amountEl.value, 10) < 1000) {
      this.showToast('La apuesta mínima es de 1,000 bits.', 'error');
      return;
    }

    const amount = parseInt(amountEl.value, 10);
    const telegramId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;

    if (!telegramId) {
      this.showToast('Error: No se detectó usuario de Telegram.', 'error');
      return;
    }

    const btn = document.querySelector('.sm-betslip-submit');
    if (btn) btn.disabled = true;

    try {
      const res = await fetch('/sports/api/bet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_id: String(telegramId),
          match_id: this.currentMatchId,
          match_name: this.currentMatchName,
          team_choice: this.currentTeamChoice,
          odd: this.currentOdd,
          amount: amount,
          sport_source: window.SPORT_CONFIG?.source || 'soccer'
        })
      });

      const data = await res.json();
      if (btn) btn.disabled = false;

      if (data.success) {
        this.showToast('✅ ¡Apuesta realizada con éxito!');
        this.close();
        // Update badge count
        MyBetsPanel.incrementBadge();
        // Update balance in UI
        window.dispatchEvent(new CustomEvent('balanceUpdated', { detail: { new_balance: data.new_balance } }));
        const bitsDisplay = document.getElementById('user-bits');
        if (bitsDisplay) bitsDisplay.textContent = Math.floor(data.new_balance).toLocaleString();
      } else {
        this.showToast(data.error || 'Ocurrió un error', 'error');
      }
    } catch (err) {
      console.error(err);
      if (btn) btn.disabled = false;
      this.showToast('Error de conexión', 'error');
    }
  }
};

/* ─── MY BETS PANEL ─────────────────────────────────────────────────────────── */
const MyBetsPanel = {
  _badgeCount: 0,

  incrementBadge() {
    this._badgeCount++;
    this._updateBadge();
  },

  _updateBadge() {
    const badge = document.getElementById('my-bets-badge');
    if (!badge) return;
    badge.textContent = this._badgeCount;
    badge.style.display = this._badgeCount > 0 ? 'flex' : 'none';
  },

  async open() {
    const overlay = document.getElementById('my-bets-overlay');
    const panel   = document.getElementById('my-bets-panel');
    if (!overlay || !panel) return;
    overlay.classList.add('open');
    panel.classList.add('open');
    this._badgeCount = 0;
    this._updateBadge();
    await this._loadBets();
  },

  close() {
    const overlay = document.getElementById('my-bets-overlay');
    const panel   = document.getElementById('my-bets-panel');
    if (overlay) overlay.classList.remove('open');
    if (panel)   panel.classList.remove('open');
  },

  _statusLabel(s) {
    if (s === 'won')  return '<span class="bet-card-status won">Ganada</span>';
    if (s === 'lost') return '<span class="bet-card-status lost">Perdida</span>';
    return '<span class="bet-card-status pending">Pendiente</span>';
  },

  async _loadBets() {
    const body = document.getElementById('my-bets-body');
    if (!body) return;

    const telegramId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
    if (!telegramId) {
      body.innerHTML = '<div class="my-bets-empty"><div class="empty-icon">🔒</div>No se detectó usuario de Telegram.</div>';
      return;
    }

    body.innerHTML = `
      <div style="padding:30px; text-align:center; color:rgba(255,255,255,.3);">
        <div style="font-size:1.5rem;margin-bottom:10px;">⏳</div>Cargando apuestas...
      </div>`;

    try {
      const res  = await fetch(`/sports/api/bets/${telegramId}`);
      const bets = await res.json();

      if (!Array.isArray(bets) || bets.length === 0) {
        body.innerHTML = `<div class="my-bets-empty"><div class="empty-icon">🎯</div>Aún no has realizado ninguna apuesta deportiva.</div>`;
        return;
      }

      let html = '';
      bets.forEach(b => {
        const match    = b.match || `${b.team1 || '?'} vs ${b.team2 || '?'}`;
        const choice   = b.choice || b.team_choice || '—';
        const amount   = (b.amount || 0).toLocaleString();
        const odd      = parseFloat(b.odd || 1).toFixed(2);
        const potWin   = (b.potential_win || 0).toLocaleString();
        const status   = b.status || 'pending';
        const dateStr  = b.date
          ? new Date(b.date).toLocaleString('es-MX', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
          : '';

        html += `
          <div class="bet-card">
            <div class="bet-card-top">
              <span class="bet-card-match" title="${match}">${match}</span>
              ${this._statusLabel(status)}
            </div>
            <div class="bet-card-details">
              <span class="bet-card-choice">🎯 ${choice}</span>
              <span class="bet-card-chip">Apostado: <strong>${amount} bits</strong></span>
              <span class="bet-card-chip">Cuota: <strong>${odd}</strong></span>
              <span class="bet-card-chip">Ganancia potencial: <strong>${potWin} bits</strong></span>
              ${dateStr ? `<span class="bet-card-chip">${dateStr}</span>` : ''}
            </div>
          </div>`;
      });

      body.innerHTML = html;
    } catch (err) {
      console.error('[MyBets]', err);
      body.innerHTML = `<div class="my-bets-empty"><div class="empty-icon">⚠️</div>No se pudieron cargar las apuestas.</div>`;
    }
  },

  /** Inject the FAB button and panel into the current page */
  inject() {
    // FAB button (above bet slip)
    if (!document.getElementById('my-bets-fab')) {
      const fab = document.createElement('button');
      fab.id = 'my-bets-fab';
      fab.innerHTML = `🎫 Mis Apuestas <span class="fab-badge" id="my-bets-badge" style="display:none;">0</span>`;
      fab.addEventListener('click', () => MyBetsPanel.open());
      document.body.appendChild(fab);
    }

    // Overlay
    if (!document.getElementById('my-bets-overlay')) {
      const overlay = document.createElement('div');
      overlay.id = 'my-bets-overlay';
      overlay.addEventListener('click', () => MyBetsPanel.close());
      document.body.appendChild(overlay);
    }

    // Panel
    if (!document.getElementById('my-bets-panel')) {
      const panel = document.createElement('div');
      panel.id = 'my-bets-panel';
      panel.innerHTML = `
        <div class="my-bets-handle"></div>
        <div class="my-bets-header">
          <span class="my-bets-title">🎫 Mis Apuestas</span>
          <button class="my-bets-close" onclick="MyBetsPanel.close()">×</button>
        </div>
        <div class="my-bets-body" id="my-bets-body"></div>
      `;
      document.body.appendChild(panel);
    }
  }
};

/* ─── GLOBAL BINDINGS ────────────────────────────────────────────────────────── */
window.openBetSlip = (matchId, teamChoice, matchName, odd) => BetSlipAPI.open(matchId, teamChoice, matchName, odd);
window.closeBetSlip = () => BetSlipAPI.close();
window.submitBet    = () => BetSlipAPI.submit();
window.MyBetsPanel  = MyBetsPanel;

/* Auto-inject on DOM ready */
document.addEventListener('DOMContentLoaded', () => {
  MyBetsPanel.inject();
});
