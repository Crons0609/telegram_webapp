/**
 * Casino Online - Admin Panel SPA Logic
 */

document.addEventListener('DOMContentLoaded', () => {
    // Check if we are on the login view
    const loginForm = document.getElementById('adminLoginForm');
    if (loginForm) {
        initLogin(loginForm);
    } else {
        // We are inside the admin panel
        initAdminPanel();
    }
});

// --- LOGIN LOGIC ---
function initLogin(form) {
    const errorDiv = document.getElementById('loginError');
    const btn = document.getElementById('loginBtn');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span> Verifying...</span>';
        btn.disabled = true;
        errorDiv.textContent = '';

        const formData = new FormData(form);
        try {
            const res = await fetch('/admin/login', {
                method: 'POST',
                body: formData
            });

            // Si el backend devuelve un HTML (redirección tradicional) o JSON
            const contentType = res.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                const data = await window.jsonParseResponse(res);
                if (data.success) {
                    window.location.href = data.redirect || '/admin/';
                } else {
                    errorDiv.textContent = data.message || 'Error de credenciales.';
                    btn.innerHTML = '<span>Acceder al Panel</span><i class="fas fa-arrow-right"></i>';
                    btn.disabled = false;
                }
            } else {
                // Posible redirección HTTP normal interceptada por Fetch
                if (res.redirected) {
                    window.location.href = res.url;
                }
            }
        } catch (err) {
            errorDiv.textContent = 'Connection error. Please try again.';
            btn.innerHTML = '<span>Acceder al Panel</span><i class="fas fa-arrow-right"></i>';
            btn.disabled = false;
        }
    });

    window.jsonParseResponse = async (res) => { return await res.json(); };
}

// --- ADMIN PANEL LOGIC ---
let mainChart = null; // Chart.js instance
let currentView = 'dashboard';
let autoRefreshInterval = null;

function initAdminPanel() {
    // 1. Clock
    updateClock();
    setInterval(updateClock, 1000);

    // 2. Navigation
    const navItems = document.querySelectorAll('.nav-item[data-view]');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const view = item.dataset.view;
            switchView(view);

            // Update active state
            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');
        });
    });

    // 2.b Sidebar Toggle (works on both desktop and mobile)
    const mobileToggle = document.getElementById('mobileMenuToggle');
    const sidebar = document.querySelector('.sidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');

    function openSidebar() {
        sidebar.classList.add('open');
        if (sidebarOverlay) sidebarOverlay.classList.add('active');
    }
    function closeSidebar() {
        sidebar.classList.remove('open');
        if (sidebarOverlay) sidebarOverlay.classList.remove('active');
    }
    function toggleSidebar() {
        if (sidebar.classList.contains('open')) {
            closeSidebar();
        } else {
            openSidebar();
        }
    }

    if (mobileToggle && sidebar) {
        mobileToggle.addEventListener('click', toggleSidebar);
    }
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', closeSidebar);
    }

    // 2.c Close sidebar on mobile when a nav item is clicked
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            if (window.innerWidth <= 900) {
                closeSidebar();
            }
        });
    });

    // 3. Setup Modals
    setupModals();

    // 4. Setup Filters and Searches
    setupFilters();

    // 5. Load Initial View
    switchView('dashboard');

    // 6. Auto-refresh every 30 seconds
    autoRefreshInterval = setInterval(() => {
        refreshCurrentView();
    }, 30000);
}

function refreshCurrentView() {
    switch (currentView) {
        case 'dashboard': loadDashboard(); break;
        case 'players': loadPlayers(); break;
        case 'missions': loadMissions(); break;
        case 'history': loadHistory(); break;
        case 'admins': loadAdmins(); break;
    }
}


function updateClock() {
    const el = document.getElementById('currentDateTime');
    if (el) {
        const now = new Date();
        const options = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
        el.textContent = now.toLocaleDateString('en-US', options);
    }
}

// --- VIEW ROUTER ---
function switchView(viewName) {
    currentView = viewName;

    // Hide all
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));

    // Show target
    const target = document.getElementById(`view-${viewName}`);
    if (target) target.classList.add('active');

    // Update Title
    const titleMap = {
        'dashboard': 'Casino Overview',
        'players': 'Players Management',
        'missions': 'Missions Config',
        'history': 'Games History',
        'admins': 'Admins Management',
        'temas': 'Temas Globales'
    };
    document.getElementById('currentPageTitle').textContent = titleMap[viewName] || 'Dashboard';

    // Load Data
    switch (viewName) {
        case 'dashboard': loadDashboard(); break;
        case 'players': loadPlayers(); break;
        case 'missions': loadMissions(); break;
        case 'history': loadHistory(); break;
        case 'admins': loadAdmins(); break;
        case 'temas': loadTemas(); break;
    }
}

// --- API FETCHERS ---

// DASHBOARD
async function loadDashboard() {
    try {
        const res = await fetch('/admin/api/dashboard');
        const data = await res.json();

        if (data.success) {
            renderKPIs(data.stats);
            renderFinancialKPIs(data.stats.financials || {});
            renderChart(data.stats);
        } else {
            showToast('Error cargando dashboard: ' + (data.error || 'desconocido'), 'error');
        }
    } catch (err) {
        console.error('Dashboard error:', err);
        showToast('Error cargando dashboard data', 'error');
    }
}

function renderKPIs(stats) {
    const n = (val) => (val || 0).toLocaleString();
    const kpis = [
        { title: 'Total Registrados', value: n(stats.total_players), icon: 'fa-users', color: 'primary' },
        { title: 'Jugadores Activos', value: n(stats.active_players), icon: 'fa-gamepad', color: 'secondary' },
        { title: 'Bits en Economía', value: n(stats.total_bits), icon: 'fa-coins', color: 'primary' },
        { title: 'Ganancia Casino (Bits)', value: n(stats.total_lost), icon: 'fa-chart-area', color: 'success' }
    ];

    const container = document.getElementById('dashboardKPIs');
    container.innerHTML = kpis.map(k => `
        <div class="kpi-card">
            <div class="kpi-title">${k.title}</div>
            <div class="kpi-value">${k.value}</div>
            <i class="fas ${k.icon} kpi-icon"></i>
        </div>
    `).join('');
}

function renderFinancialKPIs(fin) {
    const formatCurrency = (val) => '$' + (val || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formatBits = (val) => (val || 0).toLocaleString() + ' Bits';
    const n = (val) => (val || 0).toLocaleString();

    const secUSD = [
        { title: 'Ingresos (Histórico)', value: formatCurrency(fin.total_usd_invested), icon: 'fa-sack-dollar', color: 'success' },
        { title: 'Retiros (Histórico)', value: formatCurrency(fin.total_usd_paid), icon: 'fa-hand-holding-dollar', color: 'danger' },
        { title: 'Ganancia Neta (Hoy)', value: formatCurrency(fin.usd_net_day), icon: 'fa-money-bill-trend-up', color: 'success' },
        { title: 'Ganancia Neta (Semana)', value: formatCurrency(fin.usd_net_week), icon: 'fa-money-bill-trend-up', color: 'success' },
        { title: 'Ganancia Neta (Mes)', value: formatCurrency(fin.usd_net_month), icon: 'fa-money-bill-trend-up', color: 'success' }
    ];

    const secBits = [
        { title: 'Ganancia (Hoy)', value: formatBits(fin.bits_profit_day), icon: 'fa-calendar-day', color: 'warning' },
        { title: 'Ganancia (Semana)', value: formatBits(fin.bits_profit_week), icon: 'fa-calendar-week', color: 'warning' },
        { title: 'Ganancia (Mes)', value: formatBits(fin.bits_profit_month), icon: 'fa-calendar-alt', color: 'warning' }
    ];

    const secTx = [
        { title: 'Totales (Histórico)', value: n(fin.total_transactions), icon: 'fa-money-bill-transfer', color: 'primary' },
        { title: 'Volumen (Hoy)', value: n(fin.tx_day), icon: 'fa-exchange-alt', color: 'primary' },
        { title: 'Volumen (Semana)', value: n(fin.tx_week), icon: 'fa-exchange-alt', color: 'primary' },
        { title: 'Volumen (Mes)', value: n(fin.tx_month), icon: 'fa-exchange-alt', color: 'primary' }
    ];

    const renderGrid = (id, data) => {
        const el = document.getElementById(id);
        if (el) {
            el.innerHTML = data.map(k => `
                <div class="kpi-card" style="border-top: 3px solid var(--${k.color});">
                    <div class="kpi-title" style="color:var(--${k.color});">${k.title}</div>
                    <div class="kpi-value">${k.value}</div>
                    <i class="fas ${k.icon} kpi-icon" style="color:var(--${k.color}); opacity:0.1; font-size: 3rem; transform: translate(-10%, -10%);"></i>
                </div>
            `).join('');
        }
    };

    renderGrid('financialUSD', secUSD);
    renderGrid('financialBits', secBits);
    renderGrid('financialTx', secTx);
}

function renderChart(stats) {
    const ctx = document.getElementById('mainChart');
    if (!ctx) return;

    if (mainChart) mainChart.destroy();

    mainChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Total Bits Payout (Won by players)', 'Total Casino Profit (Lost by players)'],
            datasets: [{
                data: [stats.total_won, stats.total_lost],
                backgroundColor: [
                    'rgba(59, 130, 246, 0.8)', // Blue
                    'rgba(16, 185, 129, 0.8)'  // Green
                ],
                borderColor: [
                    'rgba(59, 130, 246, 1)',
                    'rgba(16, 185, 129, 1)'
                ],
                borderWidth: 1,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#94a3b8', font: { family: 'Inter', size: 12 } }
                }
            },
            cutout: '70%'
        }
    });
}

// PLAYERS
let playersData = [];
let playersListenerAttached = false;
function loadPlayers() {
    if (playersListenerAttached) return; // Ya estamos escuchando en tiempo real

    const tbody = document.querySelector('#playersTable tbody');
    tbody.innerHTML = '<tr><td colspan="6" class="text-center loading-row"><i class="fas fa-spinner fa-spin"></i> Conectando a Firebase...</td></tr>';

    if (window.escucharClientes) {
        window.escucharClientes((list) => {
            // Ordenar por bits descendente, igual que el backend
            playersData = list.sort((a,b) => (b.bits || 0) - (a.bits || 0));
            renderPlayersTable(playersData);
        });
        playersListenerAttached = true;
    } else {
        // Fallback a API si firebase.js falla
        fetch('/admin/api/players')
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    playersData = data.players;
                    renderPlayersTable(playersData);
                }
            })
            .catch(err => showToast('Error cargando players', 'error'));
    }
}

function renderPlayersTable(players) {
    const tbody = document.querySelector('#playersTable tbody');
    if (players.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No players found</td></tr>';
        return;
    }

    tbody.innerHTML = players.map(p => `
        <tr>
            <td><span class="badge-status" style="background: rgba(255,255,255,0.05); color: #94a3b8;">#${p.id}</span></td>
            <td>
                <div class="player-info-cell">
                    <div class="player-avatar-text">${p.nombre ? p.nombre.charAt(0).toUpperCase() : '?'}</div>
                    <div style="display:flex; flex-direction:column;">
                        <strong>${p.nombre || 'Unknown'}</strong>
                        <span style="font-size: 0.8rem; color: #94a3b8;">${p.username ? '@' + p.username : p.telegram_id}</span>
                    </div>
                </div>
            </td>
            <td>
                <div style="font-weight: 600; color: var(--primary);">Level ${p.nivel}</div>
                <div style="font-size: 0.8rem; color: #94a3b8;">${p.xp} XP</div>
            </td>
            <td style="font-family: var(--font-heading); font-weight: 600;">${p.bits.toLocaleString()}</td>
            <td>${p.juegos_jugados || 0}</td>
            <td>
                <button class="btn-action edit" onclick="openEditPlayerModal(${p.id})" title="Edit"><i class="fas fa-edit"></i></button>
                <button class="btn-action delete" onclick="confirmDeletePlayer(${p.id})" title="Delete"><i class="fas fa-trash-alt"></i></button>
            </td>
        </tr>
    `).join('');
}

// MISSIONS
async function loadMissions() {
    const container = document.getElementById('missionsGrid');
    container.innerHTML = '<div class="loading-state"><i class="fas fa-spinner fa-spin"></i> Fetching missions...</div>';

    try {
        const res = await fetch('/admin/api/missions');
        const data = await res.json();

        if (data.success) {
            renderMissions(data.missions);
        }
    } catch (err) {
        showToast('Error loading missions', 'error');
    }
}

function renderMissions(missions) {
    const container = document.getElementById('missionsGrid');
    container.innerHTML = missions.map(m => `
        <div class="mission-card">
            <div class="mission-header">
                <div style="display:flex; align-items:center;">
                    <div class="mission-icon"><i class="fas fa-bullseye"></i></div>
                    <div class="mission-info">
                        <h3>${m.id || 'Mission'}</h3>
                        <p>Mission Configuration</p>
                    </div>
                </div>
                <div>
                    <label class="switch">
                        <input type="checkbox" onchange="toggleMission('${m.id}', this.checked)" ${m.is_active ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                </div>
            </div>
            <div class="mission-levels">
                ${m.levels.map(l => `
                    <div class="level-row">
                        <div>
                            <span class="badge-level">Lvl ${l.level}</span>
                            <span style="font-size:0.85rem; color: #94a3b8; margin-left:10px;">Target: ${l.target}</span>
                        </div>
                        <div style="display:flex; align-items:center; gap: 1rem;">
                            <span style="font-size:0.85rem; color: var(--primary); font-weight:bold;">${l.bits_reward} Bits</span>
                            <button class="btn-action edit" onclick="openEditMissionLevel(${l.id}, ${l.level}, ${l.target}, ${l.xp_reward}, ${l.bits_reward})"><i class="fas fa-pen" style="font-size:0.8rem;"></i></button>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');
}

async function toggleMission(id, newState) {
    try {
        await fetch(`/admin/api/missions/${id}/toggle`, { method: 'POST' });
        showToast('Mission status updated');
    } catch {
        showToast('Failed to update mission', 'error');
    }
}

// HISTORY
let historyData = [];
async function loadHistory() {
    const tbody = document.querySelector('#historyTable tbody');
    tbody.innerHTML = '<tr><td colspan="6" class="text-center loading-row"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>';

    try {
        const res = await fetch('/admin/api/history');
        const data = await res.json();

        if (data.success) {
            historyData = data.history;
            renderHistoryTable(historyData);
        }
    } catch (err) {
        showToast('Error loading history', 'error');
    }
}

function formatGameName(game) {
    const icons = {
        'ruleta_francesa': '<i class="fas fa-dharmachakra" style="color:#ef4444;"></i> Roulette',
        'moche': '<i class="fas fa-dice" style="color:#d4af37;"></i> Moche',
        'blackjack': '<i class="fas fa-clone" style="color:#fff;"></i> Blackjack',
        'slot_machine': '<i class="fas fa-gem" style="color:#3b82f6;"></i> Slots'
    };
    return icons[game] || game;
}

function renderHistoryTable(records) {
    const tbody = document.querySelector('#historyTable tbody');
    if (records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No recent history</td></tr>';
        return;
    }

    tbody.innerHTML = records.map(h => {
        const date = new Date(h.fecha).toLocaleString();
        const badgeClass = h.resultado === 'win' ? 'badge-win' : (h.resultado === 'loss' ? 'badge-loss' : '');
        let gananciaStatus = h.ganancia > 0 ? `<span style="color:var(--success)">+${h.ganancia}</span>` : `<span style="color:var(--danger)">${h.ganancia}</span>`;
        if (h.ganancia === 0) gananciaStatus = "0";

        return `
        <tr>
            <td style="font-size:0.85rem; color:#94a3b8;">${date}</td>
            <td style="font-weight:500;">${formatGameName(h.juego)}</td>
            <td>${h.nombre || h.telegram_id}</td>
            <td>${h.apuesta || 0}</td>
            <td style="font-family: var(--font-heading); font-weight: 600;">${gananciaStatus}</td>
            <td><span class="badge-status ${badgeClass}">${h.resultado}</span></td>
        </tr>
    `}).join('');
}


// --- ADMINS ---
async function loadAdmins() {
    const tbody = document.querySelector('#adminsTable tbody');
    tbody.innerHTML = '<tr><td colspan="4" class="text-center"><i class="fas fa-spinner fa-spin"></i> Cargando...</td></tr>';
    try {
        const res = await fetch('/admin/api/admins');
        const data = await res.json();
        if (data.success) {
            renderAdminsTable(data.admins);
        } else {
            showToast('Error cargando administradores', 'error');
        }
    } catch { showToast('Error de red', 'error'); }
}

function renderAdminsTable(admins) {
    const tbody = document.querySelector('#adminsTable tbody');
    if (!admins || admins.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center">No hay administradores</td></tr>';
        return;
    }
    tbody.innerHTML = admins.map(a => `
        <tr>
            <td><span class="badge-status" style="background:rgba(255,255,255,0.05); color:#94a3b8;">#${a.id}</span></td>
            <td style="font-weight:600; color:#fff;"><i class="fas fa-envelope" style="color:var(--gold);margin-right:6px;"></i>${a.email}</td>
            <td style="color:#94a3b8; font-size:0.85rem;">${a.created_at || 'N/A'}</td>
            <td>
                <button class="btn-danger" onclick="deleteAdmin('${a.id}', '${a.email}')" style="background:#ef4444; border:none; color:#fff; padding:6px 12px; border-radius:8px; cursor:pointer; font-size:0.8rem;"><i class="fas fa-trash"></i> Eliminar</button>
            </td>
        </tr>
    `).join('');
}

function openAddAdminModal() {
    document.getElementById('new_admin_email').value = '';
    document.getElementById('new_admin_password').value = '';
    document.getElementById('new_admin_password2').value = '';
    document.getElementById('addAdminModal').classList.add('active');
}

async function deleteAdmin(id, email) {
    if (!confirm(`\u00bfEliminar al admin "${email}"? Esta acción no se puede deshacer.`)) return;
    try {
        const res = await fetch(`/admin/api/admins/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            showToast(`Admin "${email}" eliminado`, 'success');
            loadAdmins();
        } else {
            showToast(data.message || 'Error al eliminar', 'error');
        }
    } catch { showToast('Error de red', 'error'); }
}

// --- MODALS & FORMS ---

function setupModals() {
    // Close buttons
    document.querySelectorAll('.close-modal, .close-modal-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
        });
    });

    // Add Admin Form
    document.getElementById('addAdminForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('new_admin_email').value.trim();
        const password = document.getElementById('new_admin_password').value;
        const password2 = document.getElementById('new_admin_password2').value;

        if (password !== password2) {
            showToast('Las contraseñas no coinciden', 'error');
            return;
        }
        if (password.length < 6) {
            showToast('La contraseña debe tener al menos 6 caracteres', 'error');
            return;
        }

        const btn = document.getElementById('saveAdminBtn');
        btn.disabled = true; btn.textContent = 'Creando...';

        try {
            const res = await fetch('/admin/api/admins', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const result = await res.json();
            if (result.success) {
                showToast(`Admin "${email}" creado exitosamente`, 'success');
                document.getElementById('addAdminModal').classList.remove('active');
                loadAdmins();
            } else {
                showToast(result.message || 'Error al crear admin', 'error');
            }
        } catch { showToast('Error de red', 'error'); }
        btn.disabled = false; btn.innerHTML = '<i class="fas fa-plus"></i> Crear Admin';
    });

    // Player Edit Form

    document.getElementById('editPlayerForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('edit_player_id').value;
        const data = {
            username: document.getElementById('edit_username').value,
            bits: parseInt(document.getElementById('edit_bits').value),
            nivel: parseInt(document.getElementById('edit_nivel').value),
            xp: parseInt(document.getElementById('edit_xp').value)
        };

        const btn = document.getElementById('savePlayerBtn');
        btn.disabled = true; btn.textContent = 'Saving...';

        try {
            const res = await fetch(`/admin/api/players/${id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await res.json();
            if (result.success) {
                showToast('Player updated successfully');
                document.getElementById('editPlayerModal').classList.remove('active');
                loadPlayers(); // reload table
            } else {
                showToast('Failed to update', 'error');
            }
        } catch { showToast('Network error', 'error'); }
        btn.disabled = false; btn.textContent = 'Save Changes';
    });

    // Add Bits Form
    document.getElementById('addBitsForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('add_bits_player_id').value;
        const amount = parseInt(document.getElementById('add_bits_amount').value);
        
        const btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true; btn.textContent = 'Añadiendo...';

        try {
            const res = await fetch(`/admin/api/players/add_bits`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, amount })
            });
            const result = await res.json();
            if (result.success) {
                showToast(`Se añadieron ${amount} bits exitosamente`, 'success');
                document.getElementById('addBitsModal').classList.remove('active');
                loadPlayers(); // reload table
                loadDashboard(); // reload dashboard stats if needed
            } else {
                showToast(result.message || 'Error al añadir bits', 'error');
            }
        } catch { showToast('Network error', 'error'); }
        btn.disabled = false; btn.textContent = 'Añadir Bits';
    });

    // Mission Level Edit Form
    document.getElementById('editMissionLevelForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('edit_level_id').value;
        const data = {
            target: parseInt(document.getElementById('edit_target').value),
            xp_reward: parseInt(document.getElementById('edit_xp_reward').value),
            bits_reward: parseInt(document.getElementById('edit_bits_reward').value)
        };

        const btn = document.getElementById('saveMissionBtn');
        btn.disabled = true; btn.textContent = 'Saving...';

        try {
            const res = await fetch(`/admin/api/missions/level/${id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await res.json();
            if (result.success) {
                showToast('Mission level updated successfully');
                document.getElementById('editMissionLevelModal').classList.remove('active');
                loadMissions(); // reload grid
            } else {
                showToast('Failed to update', 'error');
            }
        } catch { showToast('Network error', 'error'); }
        btn.disabled = false; btn.textContent = 'Save Level Config';
    });

    // Confirm Delete Btn
    document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
        const id = document.getElementById('delete_player_id').value;
        document.getElementById('confirmDeleteBtn').textContent = 'Deleting...';

        try {
            const res = await fetch(`/admin/api/players/${id}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                showToast('Player deleted permanently', 'success');
                document.getElementById('deleteConfirmModal').classList.remove('active');
                loadPlayers();
            } else {
                showToast(data.message, 'error');
                document.getElementById('deleteConfirmModal').classList.remove('active');
            }
        } catch { showToast('Network error', 'error'); document.getElementById('deleteConfirmModal').classList.remove('active'); }
        document.getElementById('confirmDeleteBtn').textContent = 'Delete Player';
    });
}

function openAddBitsModal() {
    if (playersData.length === 0) {
        showToast('Espera a que carguen los jugadores', 'warning');
        return;
    }
    const select = document.getElementById('add_bits_player_id');
    select.innerHTML = '<option value="">-- Seleccionar Jugador --</option>' + 
        playersData.map(p => `<option value="${p.id}">${p.nombre || 'Desconocido'} (@${p.username || p.telegram_id}) - Bal: ${p.bits}</option>`).join('');
    
    document.getElementById('add_bits_amount').value = '';
    document.getElementById('addBitsModal').classList.add('active');
}

function openEditPlayerModal(id) {
    const player = playersData.find(p => p.id === id);
    if (!player) return;

    document.getElementById('edit_player_id').value = player.id;
    document.getElementById('edit_username').value = player.username || '';
    document.getElementById('edit_bits').value = player.bits || 0;
    document.getElementById('edit_nivel').value = player.nivel || 1;
    document.getElementById('edit_xp').value = player.xp || 0;

    document.getElementById('editPlayerModal').classList.add('active');
}

function confirmDeletePlayer(id) {
    document.getElementById('delete_player_id').value = id;
    document.getElementById('deleteConfirmModal').classList.add('active');
}

function openEditMissionLevel(id, level, target, xp, bits) {
    document.getElementById('missionLevelBadge').textContent = `Lvl ${level}`;
    document.getElementById('edit_level_id').value = id;
    document.getElementById('edit_target').value = target;
    document.getElementById('edit_xp_reward').value = xp;
    document.getElementById('edit_bits_reward').value = bits;

    document.getElementById('editMissionLevelModal').classList.add('active');
}


// --- FILTERS & SEARCH ---
function setupFilters() {
    // Players search
    document.getElementById('searchPlayers').addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = playersData.filter(p =>
            (p.nombre && p.nombre.toLowerCase().includes(term)) ||
            (p.username && p.username.toLowerCase().includes(term)) ||
            (p.telegram_id && p.telegram_id.toLowerCase().includes(term))
        );
        renderPlayersTable(filtered);
    });

    // History Filters
    const filterHistory = () => {
        const term = document.getElementById('searchHistory').value.toLowerCase();
        const game = document.getElementById('filterGame').value;

        const filtered = historyData.filter(h => {
            const matchName = (h.nombre || h.telegram_id).toLowerCase().includes(term);
            const matchGame = game === 'all' || (h.juego || '').includes(game);
            return matchName && matchGame;
        });
        renderHistoryTable(filtered);
    };

    document.getElementById('searchHistory').addEventListener('input', filterHistory);
    document.getElementById('filterGame').addEventListener('change', filterHistory);
}


// --- UTILS ---
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
    toast.innerHTML = `<i class="fas ${icon}"></i> <span>${message}</span>`;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============================================================
//  NOTIFICATION BELL SYSTEM
// ============================================================

/** Toggle the notification dropdown open/close */
window.toggleNotifPanel = function () {
    const panel = document.getElementById('notifPanel');
    const btn   = document.getElementById('notifBellBtn');
    if (!panel) return;

    const isOpen = panel.classList.contains('open');
    panel.classList.toggle('open', !isOpen);

    if (!isOpen) {
        // Load fresh notifications and mark as read in DB
        loadNotifications();
        setTimeout(() => markAllRead(), 800);
    }
};

/** Fetch notifications from backend and render them */
async function loadNotifications() {
    try {
        const res  = await fetch('/admin/api/notifications');
        const data = await res.json();
        if (!data.success) return;

        updateBell(data.unread, data.notifications);
    } catch (e) {
        console.warn('Notifications fetch failed', e);
    }
}

/** Update bell badge and list */
function updateBell(unread, notifications) {
    const badge = document.getElementById('notifBadge');
    const bell  = document.getElementById('notifBellBtn');
    const list  = document.getElementById('notifList');
    if (!badge || !bell || !list) return;

    // Badge
    if (unread > 0) {
        badge.textContent = unread > 99 ? '99+' : unread;
        badge.style.display = 'flex';
        bell.classList.add('has-unread');
    } else {
        badge.style.display = 'none';
        bell.classList.remove('has-unread');
    }

    // List
    if (!notifications || notifications.length === 0) {
        list.innerHTML = '<div class="notif-empty">Sin notificaciones</div>';
        return;
    }

    list.innerHTML = notifications.map(n => {
        const isP2P    = n.tipo === 'p2p';
        const iconClass = isP2P ? 'p2p' : 'paypal';
        const iconFA    = isP2P ? 'fab fa-telegram-plane' : 'fab fa-paypal';
        const label     = isP2P ? '📲 Solicitud P2P' : '💳 Pago PayPal';
        const user      = n.username ? `@${n.username}` : (n.nombre || n.telegram_id || '');
        const amount    = `$${parseFloat(n.usd_amount).toFixed(2)} USD &middot; ${parseInt(n.bits).toLocaleString()} Bits`;
        const time      = n.fecha ? n.fecha.slice(0, 16).replace('T', ' ') : '';
        const unreadCls = (!isP2P || n.leida) ? '' : ' unread';

        return `
        <div class="notif-item${unreadCls}">
            <div class="notif-icon ${iconClass}">
                <i class="${iconFA}"></i>
            </div>
            <div class="notif-content">
                <div class="notif-title">${label}</div>
                <div class="notif-body">${user} &middot; ${amount}</div>
                <div class="notif-time">${time}</div>
            </div>
        </div>`;
    }).join('');
}

/** Mark all notifications as read */
window.markAllRead = async function () {
    try {
        await fetch('/admin/api/notifications/read', { method: 'POST' });
        const badge = document.getElementById('notifBadge');
        const bell  = document.getElementById('notifBellBtn');
        if (badge) badge.style.display = 'none';
        if (bell)  bell.classList.remove('has-unread');
        // Remove unread class from items
        document.querySelectorAll('.notif-item.unread').forEach(el => el.classList.remove('unread'));
    } catch (e) { console.warn(e); }
};

/** Close panel when clicking outside */
document.addEventListener('click', (e) => {
    const wrapper = document.getElementById('notifWrapper');
    if (wrapper && !wrapper.contains(e.target)) {
        document.getElementById('notifPanel')?.classList.remove('open');
    }
});

// Initial load + auto-poll every 60 seconds
if (document.getElementById('notifBellBtn')) {
    loadNotifications();
    setInterval(loadNotifications, 60_000);
}


// ─── TEMAS GLOBALES ───────────────────────────────────────────────────────────

let _allThemes = [];

async function loadTemas() {
    try {
        const [tresp, sresp] = await Promise.all([
            fetch('/admin/api/themes'),
            fetch('/admin/api/themes/schedules')
        ]);
        const tdata = await tresp.json();
        const sdata = await sresp.json();
        if (tdata.success) { _allThemes = tdata.themes; renderThemeCards(tdata.themes); }
        if (sdata.success) renderSchedulesTable(sdata.schedules);
    } catch (e) {
        showToast('Error cargando temas', 'error');
    }
}

function renderThemeCards(themes) {
    const grid = document.getElementById('temasGrid');
    if (!grid) return;
    grid.innerHTML = themes.map(t => `
        <div class="card" style="padding:1.25rem; border:2px solid ${t.is_active ? t.primary_color : 'var(--border)'}; position:relative; transition:border-color 0.3s;">
            <!-- Color swatch -->
            <div style="height:8px; border-radius:4px; background:linear-gradient(90deg,${t.primary_color},${t.secondary_color}); margin-bottom:0.75rem;"></div>
            <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                <div>
                    <strong style="color:var(--text-main);">${t.name}</strong>
                    <p style="color:var(--text-muted); font-size:0.8rem; margin:0.15rem 0 0;">${t.description || t.slug}</p>
                </div>
                ${t.is_active ? '<span style="background:#10b981;color:#fff;font-size:0.7rem;padding:2px 8px;border-radius:50px;font-weight:700;">ACTIVO</span>' : ''}
            </div>
            <div style="display:flex;gap:0.5rem;margin-top:1rem; flex-wrap:wrap;">
                <div style="display:flex;gap:4px;">
                    <span title="Principal" style="display:inline-block;width:20px;height:20px;border-radius:50%;background:${t.primary_color};border:2px solid rgba(255,255,255,0.2);"></span>
                    <span title="Secundario" style="display:inline-block;width:20px;height:20px;border-radius:50%;background:${t.secondary_color};border:2px solid rgba(255,255,255,0.2);"></span>
                    <span title="Fondo" style="display:inline-block;width:20px;height:20px;border-radius:50%;background:${t.bg_color};border:2px solid rgba(255,255,255,0.2);"></span>
                </div>
                ${!t.is_active ? `<button onclick="activateTheme(${t.id})" class="btn-primary" style="font-size:0.78rem;padding:4px 12px;margin-left:auto;"><i class="fas fa-bolt"></i> Activar</button>` : '<button class="btn-secondary" style="font-size:0.78rem;padding:4px 12px;margin-left:auto;cursor:default;" disabled><i class="fas fa-check"></i> Activo</button>'}
            </div>
        </div>
    `).join('');
}

async function activateTheme(themeId) {
    try {
        const res = await fetch(`/admin/api/themes/${themeId}/activate`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast(`✅ Tema activado: ${data.active_theme.name}`, 'success');
            loadTemas();
            // Also update this browser tab's live theme immediately
            if (window.ThemeManager) window.ThemeManager.preview(data.active_theme);
        }
    } catch (e) { showToast('Error activando tema', 'error'); }
}

function renderSchedulesTable(schedules) {
    const el = document.getElementById('schedulesTable');
    if (!el) return;
    if (!schedules.length) {
        el.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:1rem;">No hay eventos programados.</p>';
        return;
    }
    el.innerHTML = `
        <table class="data-table" style="width:100%;">
            <thead><tr><th>Evento</th><th>Tema</th><th>Inicio</th><th>Fin</th><th>Prio.</th><th></th></tr></thead>
            <tbody>${schedules.map(s => `
                <tr>
                    <td>${s.event_name}</td>
                    <td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${_allThemes.find(t=>t.id===s.theme_id)?.primary_color||'#888'};margin-right:6px;"></span>${s.theme_name}</td>
                    <td style="font-size:0.82rem;">${s.start_date}</td>
                    <td style="font-size:0.82rem;">${s.end_date}</td>
                    <td>${s.priority}</td>
                    <td><button onclick="deleteSchedule(${s.id})" style="background:#ef4444;color:#fff;border:none;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:0.8rem;"><i class="fas fa-trash"></i></button></td>
                </tr>
            `).join('')}</tbody>
        </table>`;
}

async function deleteSchedule(id) {
    if (!confirm('¿Eliminar este evento programado?')) return;
    await fetch(`/admin/api/themes/schedules/${id}`, { method: 'DELETE' });
    showToast('Evento eliminado', 'success');
    loadTemas();
}

function openAddScheduleModal() {
    // Populate theme select
    const sel = document.getElementById('sched_theme');
    if (sel) sel.innerHTML = _allThemes.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    document.getElementById('addScheduleModal')?.classList.add('open');
}

function openThemeBuilderModal() {
    document.getElementById('themeBuilderModal')?.classList.add('open');
    // Wire color pickers <-> hex inputs
    [['tb_primary','tb_primary_hex'],['tb_secondary','tb_secondary_hex'],['tb_bg','tb_bg_hex']].forEach(([picId, hexId]) => {
        const pic = document.getElementById(picId);
        const hex = document.getElementById(hexId);
        if (!pic || !hex) return;
        pic.oninput = () => { hex.value = pic.value; updatePreviewBar(); };
        hex.oninput = () => { if (/^#[0-9a-f]{6}$/i.test(hex.value)) { pic.value = hex.value; updatePreviewBar(); } };
    });
    updatePreviewBar();
}

function updatePreviewBar() {
    const p = document.getElementById('tb_primary_hex')?.value || '#c9a227';
    const s = document.getElementById('tb_secondary_hex')?.value || '#f0cc55';
    const bar = document.getElementById('themePreviewBar');
    if (bar) bar.style.background = `linear-gradient(90deg,${p},${s})`;
}

// Wire forms
document.addEventListener('DOMContentLoaded', () => {
    // Theme Builder submit
    const tbForm = document.getElementById('themeBuilderForm');
    tbForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = {
            name: document.getElementById('tb_name').value,
            slug: document.getElementById('tb_slug').value,
            description: document.getElementById('tb_description').value,
            primary_color: document.getElementById('tb_primary_hex').value,
            secondary_color: document.getElementById('tb_secondary_hex').value,
            bg_color: document.getElementById('tb_bg_hex').value,
            background_image: document.getElementById('tb_bg_image')?.value || '',
            background_overlay: document.getElementById('tb_bg_overlay')?.value || '',
            typography: {
                family: document.getElementById('tb_font_family')?.value || ''
            },
            animations: {
                hearts: document.getElementById('tb_anim_hearts')?.checked || false,
                snow: document.getElementById('tb_anim_snow')?.checked || false
            }
        };
        const res = await fetch('/admin/api/themes', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
        const resp = await res.json();
        if (resp.success) {
            showToast('✅ Tema creado', 'success');
            tbForm.reset();
            document.getElementById('themeBuilderModal')?.classList.remove('open');
            loadTemas();
        } else { showToast('Error: ' + (resp.message||''), 'error'); }
    });

    // Add Schedule submit
    const schedForm = document.getElementById('addScheduleForm');
    schedForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = {
            theme_id: document.getElementById('sched_theme').value,
            event_name: document.getElementById('sched_event').value,
            start_date: document.getElementById('sched_start').value,
            end_date: document.getElementById('sched_end').value,
            priority: document.getElementById('sched_priority').value,
        };
        const res = await fetch('/admin/api/themes/schedules', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
        const resp = await res.json();
        if (resp.success) {
            showToast('✅ Evento programado', 'success');
            schedForm.reset();
            document.getElementById('addScheduleModal')?.classList.remove('open');
            loadTemas();
        } else { showToast('Error: ' + (resp.message||''), 'error'); }
    });
});

window.openAddScheduleModal = openAddScheduleModal;
window.openThemeBuilderModal = openThemeBuilderModal;
window.activateTheme = activateTheme;
window.deleteSchedule = deleteSchedule;
