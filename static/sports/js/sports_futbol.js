// ======================================================
// ZONA JACKPOT 777 - SECURE SPORTSBOOK JS (RESTORED)
// ======================================================

const matchesContainer = document.getElementById("matches-container");
const historyList = document.getElementById("bets-history-list");
const notificationDiv = document.getElementById("notification");
const betSound = document.getElementById("bet-sound");
const winSound = document.getElementById("win-sound");

function getTelegramId() {
  const tg = window.Telegram?.WebApp;
  return tg?.initDataUnsafe?.user?.id || '12345'; // fallback
}

// ======================================================
// INIT
// ======================================================

function init() {
  initFilters();
  loadMatches();
  loadHistory();
}

// ======================================================
// LOAD MATCHES
// ======================================================

async function loadMatches() {
  showLoader();
  try {
    const res = await fetch("/sports/api/matches");
    if(!res.ok) throw new Error("Network error");
    const matches = await res.json();
    currentMatches = matches; // Store globally for filtering
    renderMatches(matches);
  } catch(e) {
    showNotification("Error cargando partidos", "error");
  }
}

function showLoader() {
  matchesContainer.innerHTML = `
    <div class="loader" style="text-align:center; padding: 20px;">
      Cargando partidos...
    </div>
  `;
}

// ======================================================
// FILTERS
// ======================================================

let currentMatches = [];

function initFilters() {
  const filterBtns = document.querySelectorAll(".filter");
  filterBtns.forEach(btn => {
    btn.addEventListener("click", (e) => {
      // Manage active visual state
      filterBtns.forEach(b => b.classList.remove("active"));
      e.target.classList.add("active");

      // Apply Filter
      const filterMode = e.target.textContent.trim().toLowerCase();
      applyFilter(filterMode);
    });
  });
}

function applyFilter(mode) {
  if (!currentMatches || currentMatches.length === 0) return;

  const now = new Date();
  const today = now.toISOString().split('T')[0];
  
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  let filtered = currentMatches;

  if (mode === "hoy") {
    filtered = currentMatches.filter(m => m.date.startsWith(today));
  } else if (mode === "mañana") {
    filtered = currentMatches.filter(m => m.date.startsWith(tomorrowStr));
  } else if (mode === "en vivo") {
    filtered = currentMatches.filter(m => m.status === "live");
  }

  // mode "todos" just passes through all currentMatches
  renderMatches(filtered, true); // true = avoid over-writing currentMatches
}

// ======================================================
// RENDER MATCHES
// ======================================================

function renderMatches(matches, isFiltered = false) {
  matchesContainer.innerHTML = "";
  
  if(!isFiltered && matches) {
      currentMatches = matches; // safety update
  }
  
  if(!matches || matches.length === 0) {
    matchesContainer.innerHTML = `<div class="empty-history">No hay partidos disponibles para este filtro.</div>`;
    return;
  }

  matches.forEach(match => {
    const card = document.createElement("div");
    card.className = "match-card glass";
    card.dataset.id = match.id;

    card.innerHTML = `
      <div class="match-teams">
        <div class="team">${match.team1}</div>
        <div class="vs">VS</div>
        <div class="team">${match.team2}</div>
      </div>
      <div class="match-date">
        ${formatDate(match.date)}
      </div>
      <div class="bet-options">
        <div class="bet-option" data-choice="1">
           ${match.team1}<br> <strong style="color:var(--sb-accent)">${match.odds["1"]}x</strong>
        </div>
        <div class="bet-option" data-choice="X">
           Empate<br> <strong style="color:var(--sb-accent)">${match.odds["X"]}x</strong>
        </div>
        <div class="bet-option" data-choice="2">
           ${match.team2}<br> <strong style="color:var(--sb-accent)">${match.odds["2"]}x</strong>
        </div>
      </div>
      <div class="bet-input">
        <input type="number" placeholder="Cantidad" min="10" class="bet-amount">
        <button class="place-bet">Apostar</button>
      </div>
    `;

    // Seleccionar opcion (Exact behavior from original)
    const options = card.querySelectorAll(".bet-option");
    options.forEach(opt => {
      opt.addEventListener("click", () => {
        options.forEach(o => o.classList.remove("selected"));
        opt.classList.add("selected");
      });
    });

    // Apostar
    card.querySelector(".place-bet").addEventListener("click", () => placeBet(card, match.id));

    matchesContainer.appendChild(card);
  });
}

// ======================================================
// PLACE BET
// ======================================================

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
  if(!tgId) {
    showNotification("Error de autenticación", "error");
    return;
  }

  const teamChoice = selected.dataset.choice;
  const placeBtn = card.querySelector(".place-bet");
  placeBtn.textContent = "Procesando...";
  placeBtn.disabled = true;

  try {
    const res = await fetch("/sports/api/bet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        telegram_id: String(tgId),
        match_id: matchId,
        team_choice: teamChoice,
        amount: amount
      })
    });

    const data = await res.json();

    if (data.error || !data.success) {
      showNotification(data.error || "Error al realizar apuesta", "error");
      placeBtn.textContent = "Apostar";
      placeBtn.disabled = false;
      return;
    }

    // Sonido
    if (betSound) betSound.play().catch(()=>{});

    showNotification("Apuesta realizada", "success");
    animateCard(card);
    
    // Update live bits
    updateBalanceDisplay(data.new_balance);

    // Refresh history
    loadHistory();

    // Reset UI
    amountInput.value = "";
    options = card.querySelectorAll(".bet-option");
    options.forEach(o => o.classList.remove("selected"));
    
    setTimeout(() => {
        placeBtn.textContent = "Apostar";
        placeBtn.disabled = false;
    }, 500);

  } catch(e) {
    showNotification("Error apostando", "error");
    placeBtn.textContent = "Apostar";
    placeBtn.disabled = false;
  }
}

// ======================================================
// ANIMATIONS & BALANCE
// ======================================================

function animateCard(card) {
  card.style.transform = "scale(0.95)";
  setTimeout(() => {
    card.style.transform = "";
  }, 200);
}

function updateBalanceDisplay(balance) {
  // Update the global header displays
  const bitsDisplays = document.querySelectorAll(".header-user .user-info strong, .user-info strong.text-gold");
  bitsDisplays.forEach(el => {
    el.textContent = balance.toLocaleString();
    el.style.transform = "scale(1.2)";
    setTimeout(() => el.style.transform = "scale(1)", 200);
  });
}

// ======================================================
// BET HISTORY
// ======================================================

async function loadHistory() {
  const tgId = getTelegramId();
  if(!tgId) return;

  historyList.innerHTML = `<div class="loader" style="text-align:center; padding: 20px;">Cargando historial...</div>`;
  
  try {
    const res = await fetch(`/sports/api/bets/${tgId}`);
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
      
      let statusColor = b.status === 'won' ? '#00ff85' : (b.status === 'lost' ? '#ff003c' : '#ffd700');
      let statusText = b.status === 'won' ? 'Ganada' : (b.status === 'lost' ? 'Perdida' : 'Pendiente');

      el.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom: 5px;">
          <strong>${b.match}</strong>
          <span style="color: ${statusColor}; font-weight: bold; text-transform: uppercase; font-size:0.8em">${statusText}</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size: 0.9em; opacity: 0.8; margin-bottom: 5px;">
           <span>Tu Elección: <strong style="color: var(--sb-accent)">${b.choice}</strong> a ${b.odd.toFixed(2)}x</span>
           <span>Apuesta: ${b.amount} bits</span>
        </div>
        <div style="font-size: 0.8em; margin-top: 5px; opacity: 0.6; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 5px;">
          Potencial: <strong style="color:var(--sb-accent)">${b.potential_win.toLocaleString()}</strong> bits <span style="float:right">${formatDate(b.date)}</span>
        </div>
      `;
      historyList.appendChild(el);
    });
  } catch (e) {
    historyList.innerHTML = `<div class="empty-history">No se pudo cargar el historial.</div>`;
  }
}

// ======================================================
// NOTIFICATIONS & UTILS
// ======================================================

function showNotification(msg, type="info") {
  const notif = document.createElement("div");
  notif.className = `notification ${type}`;
  notif.textContent = msg;
  notificationDiv.appendChild(notif);
  setTimeout(() => {
    notif.remove();
  }, 3000);
}

function formatDate(date) {
  const d = new Date(date);
  return d.toLocaleString([], {hour: '2-digit', minute:'2-digit', day:'2-digit', month:'short'});
}

// ======================================================
// START
// ======================================================
document.addEventListener("DOMContentLoaded", init);
