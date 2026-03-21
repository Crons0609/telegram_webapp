// ============================================================
// ZONA JACKPOT 777 — SPORTSBOOK FRONTEND
// Integrado con football-data.org v4 via FOOTBALL_API
// ============================================================

// DOM References
const matchesContainer  = document.getElementById("matches-container");
const liveContainer     = document.getElementById("live-container");
const historyList       = document.getElementById("bets-history-list");
const notificationDiv   = document.getElementById("notification");
const betSound          = document.getElementById("bet-sound");
const winSound          = document.getElementById("win-sound");

// State
let currentMatches  = [];
let liveRefreshTimer = null;
const LIVE_REFRESH_INTERVAL = 60_000; // 60 s

// ============================================================
// TELEGRAM AUTH
// ============================================================

function getTelegramId() {
  const tg = window.Telegram?.WebApp;
  return tg?.initDataUnsafe?.user?.id || "12345";
}

// ============================================================
// INIT
// ============================================================

function init() {
  // Listen for rate-limit events from the API module
  window.addEventListener("footballApi:ratelimit", (e) => {
    const wait = e.detail?.waitSeconds || 60;
    showNotification(`Rate limit — espera ${wait}s`, "error");
  });

  initFilters();
  loadAllMatches();
  loadLiveSection();
  loadHistory();

  // Auto-refresh live section
  liveRefreshTimer = setInterval(loadLiveSection, LIVE_REFRESH_INTERVAL);
}

// ============================================================
// LOAD ALL MATCHES (real API)
// ============================================================

async function loadAllMatches() {
  showSkeleton(matchesContainer, 6);

  const matches = await FOOTBALL_API.getMatches();

  if (!matches || matches.length === 0) {
    renderEmptyState(matchesContainer, "No hay partidos disponibles por ahora.");
    return;
  }

  currentMatches = matches;
  renderMatches(matches);
}

// ============================================================
// LIVE SECTION (auto-refresh)
// ============================================================

async function loadLiveSection() {
  if (!liveContainer) return;

  const liveMatches = await FOOTBALL_API.getLiveMatches();

  // Toggle live section visibility
  const liveSection = document.getElementById("live-section");
  if (liveSection) {
    liveSection.style.display = (liveMatches && liveMatches.length > 0) ? "block" : "none";
  }

  if (!liveMatches || liveMatches.length === 0) {
    liveContainer.innerHTML = "";
    return;
  }

  liveContainer.innerHTML = "";
  liveMatches.forEach(match => {
    const card = buildMatchCard(match, true);
    liveContainer.appendChild(card);
  });
}

// ============================================================
// FILTERS
// ============================================================

function initFilters() {
  const filterBtns = document.querySelectorAll(".filter");
  filterBtns.forEach(btn => {
    btn.addEventListener("click", (e) => {
      filterBtns.forEach(b => b.classList.remove("active"));
      e.currentTarget.classList.add("active");
      applyFilter(e.currentTarget.dataset.filter || e.currentTarget.textContent.trim().toLowerCase());
    });
  });
}

function applyFilter(mode) {
  if (!currentMatches || currentMatches.length === 0) return;

  const now      = new Date();
  const today    = now.toISOString().split("T")[0];
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split("T")[0];

  let filtered;

  switch (mode) {
    case "hoy":
      filtered = currentMatches.filter(m => m.date && m.date.startsWith(today));
      break;
    case "mañana":
      filtered = currentMatches.filter(m => m.date && m.date.startsWith(tomorrowStr));
      break;
    case "en vivo":
      filtered = currentMatches.filter(m => m.status === "live");
      break;
    default: // "todos"
      filtered = currentMatches;
  }

  renderMatches(filtered, true);
}

// ============================================================
// RENDER MATCHES
// ============================================================

function renderMatches(matches, isFiltered = false) {
  matchesContainer.innerHTML = "";

  if (!isFiltered && matches) currentMatches = matches;

  if (!matches || matches.length === 0) {
    renderEmptyState(matchesContainer, "No hay partidos para este filtro.");
    return;
  }

  matches.forEach(match => {
    const card = buildMatchCard(match, false);
    matchesContainer.appendChild(card);
  });
}

// ============================================================
// BUILD MATCH CARD
// ============================================================

function buildMatchCard(match, isLive = false) {
  const card = document.createElement("div");
  const statusClass = isLive ? "match-card glass match-status-live" : "match-card glass";
  card.className = statusClass;
  card.dataset.id = match.id;

  // Score / time display
  const scoreHtml = (isLive && match.score.home !== null)
    ? `<div class="score-display">${match.score.home} — ${match.score.away}${match.minute ? ` <span class="match-minute">${match.minute}'</span>` : ""}</div>`
    : "";

  const liveBadgeHtml = isLive
    ? `<span class="live-badge">🔴 EN VIVO</span>`
    : "";

  const compHtml = match.competition
    ? `<div class="competition-pill">${match.competition}</div>`
    : "";

  card.innerHTML = `
    <div class="card-header-row">
      ${compHtml}
      ${liveBadgeHtml}
    </div>
    <div class="match-teams">
      <div class="team">${match.team1}</div>
      <div class="vs">${scoreHtml || "VS"}</div>
      <div class="team">${match.team2}</div>
    </div>
    <div class="match-date">${formatDate(match.date)}</div>
    <div class="bet-options">
      <div class="bet-option" data-choice="1">
        ${match.team1}<br><strong style="color:var(--accent)">${match.odds["1"]}x</strong>
      </div>
      <div class="bet-option" data-choice="X">
        Empate<br><strong style="color:var(--accent)">${match.odds["X"]}x</strong>
      </div>
      <div class="bet-option" data-choice="2">
        ${match.team2}<br><strong style="color:var(--accent)">${match.odds["2"]}x</strong>
      </div>
    </div>
    <div class="bet-input">
      <input type="number" placeholder="Cantidad" min="10" class="bet-amount">
      <button class="place-bet">Apostar</button>
    </div>
  `;

  // Bet option selection
  const options = card.querySelectorAll(".bet-option");
  options.forEach(opt => {
    opt.addEventListener("click", () => {
      options.forEach(o => o.classList.remove("selected"));
      opt.classList.add("selected");
    });
  });

  // Place bet
  card.querySelector(".place-bet").addEventListener("click", () => placeBet(card, match.id));

  return card;
}

// ============================================================
// PLACE BET (unchanged — local Flask API)
// ============================================================

async function placeBet(card, matchId) {
  const selected = card.querySelector(".bet-option.selected");

  if (!selected) {
    showNotification("Selecciona un resultado", "error");
    return;
  }

  const amountInput = card.querySelector(".bet-amount");
  const amount = parseInt(amountInput.value);

  if (!amount || amount <= 0) {
    showNotification("Cantidad inválida", "error");
    return;
  }

  const tgId = getTelegramId();
  if (!tgId) {
    showNotification("Error de autenticación", "error");
    return;
  }

  const teamChoice = selected.dataset.choice;
  const placeBtn   = card.querySelector(".place-bet");
  placeBtn.textContent = "Procesando...";
  placeBtn.disabled    = true;

  try {
    const res = await fetch("/sports/api/bet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        telegram_id:  String(tgId),
        match_id:     matchId,
        team_choice:  teamChoice,
        amount
      })
    });

    const data = await res.json();

    if (data.error || !data.success) {
      showNotification(data.error || "Error al realizar apuesta", "error");
      placeBtn.textContent = "Apostar";
      placeBtn.disabled    = false;
      return;
    }

    if (betSound) betSound.play().catch(() => {});

    showNotification("¡Apuesta realizada! 🎯", "success");
    animateCard(card);
    updateBalanceDisplay(data.new_balance);
    loadHistory();

    amountInput.value = "";
    card.querySelectorAll(".bet-option").forEach(o => o.classList.remove("selected"));
    setTimeout(() => { placeBtn.textContent = "Apostar"; placeBtn.disabled = false; }, 500);

  } catch (e) {
    showNotification("Error apostando", "error");
    placeBtn.textContent = "Apostar";
    placeBtn.disabled    = false;
  }
}

// ============================================================
// BET HISTORY (unchanged — local Flask API)
// ============================================================

async function loadHistory() {
  const tgId = getTelegramId();
  if (!tgId || !historyList) return;

  historyList.innerHTML = `<div class="loader" style="text-align:center;padding:20px">Cargando historial...</div>`;

  try {
    const res  = await fetch(`/sports/api/bets/${tgId}`);
    if (!res.ok) throw new Error("Network error");
    const bets = await res.json();

    if (bets.length === 0) {
      historyList.innerHTML = `<div class="empty-history">Aún no has realizado apuestas.</div>`;
      return;
    }

    historyList.innerHTML = "";
    bets.forEach(b => {
      const el = document.createElement("div");
      el.className = "history-item";

      const statusColor = b.status === "won"  ? "#00ff85"
                        : b.status === "lost" ? "#ff003c"
                        : "#ffd700";
      const statusText  = b.status === "won"  ? "Ganada"
                        : b.status === "lost" ? "Perdida"
                        : "Pendiente";

      el.innerHTML = `
        <div style="display:flex;justify-content:space-between;margin-bottom:5px">
          <strong>${b.match}</strong>
          <span style="color:${statusColor};font-weight:700;text-transform:uppercase;font-size:.8em">${statusText}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:.9em;opacity:.8;margin-bottom:5px">
          <span>Tu Elección: <strong style="color:var(--accent)">${b.choice}</strong> a ${b.odd.toFixed(2)}x</span>
          <span>Apuesta: ${b.amount} bits</span>
        </div>
        <div style="font-size:.8em;margin-top:5px;opacity:.6;border-top:1px solid rgba(255,255,255,.1);padding-top:5px">
          Potencial: <strong style="color:var(--accent)">${b.potential_win.toLocaleString()}</strong> bits
          <span style="float:right">${formatDate(b.date)}</span>
        </div>
      `;
      historyList.appendChild(el);
    });

  } catch (e) {
    historyList.innerHTML = `<div class="empty-history">No se pudo cargar el historial.</div>`;
  }
}

// ============================================================
// LOADING STATES
// ============================================================

function showSkeleton(container, count = 4) {
  container.innerHTML = Array.from({ length: count }, () => `
    <div class="match-card skeleton-card">
      <div class="skeleton skeleton-line" style="width:40%;height:12px;margin-bottom:16px"></div>
      <div class="skeleton skeleton-teams"></div>
      <div class="skeleton skeleton-line" style="width:60%;height:10px;margin:12px auto"></div>
      <div class="skeleton skeleton-options"></div>
    </div>
  `).join("");
}

function showLoader() {
  matchesContainer.innerHTML = `
    <div class="loader" style="text-align:center;padding:40px;grid-column:1/-1">
      <div class="spinner"></div>
      <p style="margin-top:12px;color:var(--text-muted)">Cargando partidos...</p>
    </div>
  `;
}

function renderEmptyState(container, msg = "No hay datos disponibles.") {
  container.innerHTML = `
    <div class="empty-state" style="grid-column:1/-1">
      <div class="empty-icon">⚽</div>
      <p class="empty-msg">${msg}</p>
    </div>
  `;
}

// ============================================================
// ANIMATIONS & BALANCE
// ============================================================

function animateCard(card) {
  card.style.transform = "scale(0.96)";
  setTimeout(() => { card.style.transform = ""; }, 200);
}

function updateBalanceDisplay(balance) {
  const els = document.querySelectorAll(".header-user .user-info strong, .user-info strong.text-gold");
  els.forEach(el => {
    el.textContent = balance.toLocaleString();
    el.style.transform = "scale(1.2)";
    setTimeout(() => { el.style.transform = "scale(1)"; }, 200);
  });
}

// ============================================================
// NOTIFICATIONS
// ============================================================

function showNotification(msg, type = "info") {
  if (!notificationDiv) return;
  const notif = document.createElement("div");
  notif.className = `notification ${type}`;
  notif.textContent = msg;
  notificationDiv.appendChild(notif);
  setTimeout(() => notif.remove(), 3500);
}

// ============================================================
// UTILS
// ============================================================

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleString("es-MX", {
    day:    "2-digit",
    month:  "short",
    hour:   "2-digit",
    minute: "2-digit",
    hour12: true
  });
}

// ============================================================
// START
// ============================================================

document.addEventListener("DOMContentLoaded", init);
