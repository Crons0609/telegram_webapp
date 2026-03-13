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
        'admins': 'Admins Management'
    };
    document.getElementById('currentPageTitle').textContent = titleMap[viewName] || 'Dashboard';

    // Load Data
    switch (viewName) {
        case 'dashboard': loadDashboard(); break;
        case 'players': loadPlayers(); break;
        case 'missions': loadMissions(); break;
        case 'history': loadHistory(); break;
        case 'admins': loadAdmins(); break;
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
async function loadPlayers() {
    const tbody = document.querySelector('#playersTable tbody');
    tbody.innerHTML = '<tr><td colspan="6" class="text-center loading-row"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>';

    try {
        const res = await fetch('/admin/api/players');
        const data = await res.json();

        if (data.success) {
            playersData = data.players;
            renderPlayersTable(playersData);
        }
    } catch (err) {
        showToast('Error loading players', 'error');
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
            <td style="font-weight:600; color:#fff;"><i class="fas fa-user-shield" style="color:var(--gold);margin-right:6px;"></i>${a.username}</td>
            <td style="color:#94a3b8; font-size:0.85rem;">${a.created_at || 'N/A'}</td>
            <td>
                <button class="btn-danger" onclick="deleteAdmin(${a.id}, '${a.username}')" style="background:#ef4444; border:none; color:#fff; padding:6px 12px; border-radius:8px; cursor:pointer; font-size:0.8rem;"><i class="fas fa-trash"></i> Eliminar</button>
            </td>
        </tr>
    `).join('');
}

function openAddAdminModal() {
    document.getElementById('new_admin_username').value = '';
    document.getElementById('new_admin_password').value = '';
    document.getElementById('new_admin_password2').value = '';
    document.getElementById('addAdminModal').classList.add('active');
}

async function deleteAdmin(id, username) {
    if (!confirm(`\u00bfEliminar al admin "${username}"? Esta acción no se puede deshacer.`)) return;
    try {
        const res = await fetch(`/admin/api/admins/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            showToast(`Admin "${username}" eliminado`, 'success');
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
        const username = document.getElementById('new_admin_username').value.trim();
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
                body: JSON.stringify({ username, password })
            });
            const result = await res.json();
            if (result.success) {
                showToast(`Admin "${username}" creado exitosamente`, 'success');
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
