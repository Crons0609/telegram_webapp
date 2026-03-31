/**
 * UserProfileManager - Frontend
 * Handles fetching, rendering profile, and level up popups.
 * Includes: Trophies, Missions, Public Profile, Level-Up Banner.
 */

window.UserProfileManager = {
    currentProfile: null,
    playtimeTracker: null,

    init: function () {
        // Start playtime tracker (1 minute pings)
        this.playtimeTracker = setInterval(() => {
            fetch('/api/profile/ping', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ minutes: 1 })
            }).catch(e => console.error("Ping error:", e));
        }, 60000);
        // Level-up banner
        if (!document.getElementById('level-up-banner')) {
            const banner = document.createElement('div');
            banner.id = 'level-up-banner';
            banner.className = 'level-up-banner';
            banner.innerHTML = `
                <h2 class="level-up-title" id="lu-title">¡NUEVO RANGO!</h2>
                <div class="level-up-icon" id="lu-icon">👑</div>
                <p class="level-up-desc" id="lu-desc">Emperador del Casino</p>
                <div id="lu-unlocks" style="margin-top:10px;font-size:0.9em;"></div>
            `;
            document.body.appendChild(banner);
        }
        // Trophy toast
        if (!document.getElementById('trophy-toast')) {
            const toast = document.createElement('div');
            toast.id = 'trophy-toast';
            toast.className = 'trophy-toast hidden';
            toast.innerHTML = `
                <img id="trophy-toast-img" src="" alt="" class="trophy-toast-img">
                <div class="trophy-toast-text">
                    <strong id="trophy-toast-name">Trofeo Desbloqueado</strong>
                    <span id="trophy-toast-desc"></span>
                </div>
            `;
            document.body.appendChild(toast);
        }
        // Mission completed toast
        if (!document.getElementById('mission-toast')) {
            const mToast = document.createElement('div');
            mToast.id = 'mission-toast';
            mToast.style.cssText = `
                position: fixed;
                bottom: 90px;
                left: 50%;
                transform: translateX(-50%) translateY(30px);
                background: linear-gradient(135deg, #0d1b2a, #1a2e0a);
                border: 1px solid #4caf50;
                border-radius: 16px;
                padding: 14px 20px;
                display: flex;
                align-items: center;
                gap: 14px;
                box-shadow: 0 10px 40px rgba(0,0,0,0.8), 0 0 20px rgba(76,175,80,0.3);
                z-index: 99998;
                opacity: 0;
                pointer-events: none;
                transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                min-width: 280px;
                max-width: 360px;
            `;
            mToast.innerHTML = `
                <div style="font-size:2rem; flex-shrink:0;" id="mission-toast-icon">🎯</div>
                <div style="display:flex; flex-direction:column; gap:4px;">
                    <strong style="color:#4caf50; font-size:0.85rem;">🏅 ¡Misión Lista para Reclamar!</strong>
                    <span id="mission-toast-name" style="color:#eee; font-size:0.82rem;"></span>
                    <span id="mission-toast-rewards" style="color:#aaa; font-size:0.75rem;"></span>
                </div>
            `;
            document.body.appendChild(mToast);
        }

        // Fetch initial inbox status (Removed for performance/cleanup)
        // setTimeout(() => this.loadInboxMessages(true), 1500);
    },

    openInboxModal: function() {
        // Notifications removed
    },

    closeInboxModal: function() {
        // Notifications removed
    },

    setPlayMode: async function(mode) {
        try {
            // Locally save the intent so next page load retains it
            localStorage.setItem('play_mode', mode);
            
            const res = await fetch('/api/user/set_mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: mode })
            });
            const data = await res.json();
            if (data.status === 'ok') {
                // UI updates are handled proactively by setHeroMode(), no reload needed.
                console.log("Play mode saved to:", mode);
            }
        } catch (e) {
            console.error("Error setting play mode:", e);
        }
    },

    loadInboxMessages: async function(badgeOnly = false) {
        if (!badgeOnly) {
            const container = document.getElementById('inbox-list-container');
            if (container) container.innerHTML = '<p class="muted" style="text-align:center;">Cargando mensajes...</p>';
        }

        try {
            const res = await fetch('/api/user/messages');
            const data = await res.json();
            
            if (data.status === 'ok') {
                // Update badge
                const badge = document.getElementById('nav-unread-badge');
                if (badge) {
                    if (data.unread > 0) {
                        badge.textContent = data.unread > 9 ? '9+' : data.unread;
                        badge.style.display = 'block';
                    } else {
                        badge.style.display = 'none';
                    }
                }

                if (!badgeOnly) {
                    this.renderInboxMessages(data.messages);
                }
            }
        } catch (e) {
            console.error("Error loading inbox:", e);
        }
    },

    renderInboxMessages: function(messages) {
        const container = document.getElementById('inbox-list-container');
        if (!container) return;

        if (!messages || messages.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding:30px 10px; color:#888;">
                    <div style="font-size:3rem; margin-bottom:10px; opacity:0.5;">📭</div>
                    <p>Tu bandeja de entrada está vacía.</p>
                </div>
            `;
            return;
        }

        let html = '';
        messages.forEach(m => {
            const unread = !m.read;
            const date = new Date(m.sent_at).toLocaleString();
            let iconText = '✉️';
            if (m.type === 'update') iconText = '🔄';
            if (m.type === 'gift') iconText = '🎁';
            if (m.type === 'warning') iconText = '⚠️';
            
            const bg = unread ? 'background: rgba(212,175,55,0.08); border-left: 3px solid var(--gold-1);' : 'background: rgba(255,255,255,0.03); border-left: 3px solid transparent; opacity: 0.8;';
            const dot = unread ? `<div style="width:8px; height:8px; background:#ef4444; border-radius:50%; position:absolute; top:12px; right:12px; box-shadow:0 0 8px #ef4444;"></div>` : '';

            // Using standard quotes inside onclick so we don't break HTML attributes
            html += `
                <div style="${bg} padding:15px; border-radius:8px; position:relative; transition:0.2s; cursor:pointer;" onclick="UserProfileManager.markMessageRead('${m.id}', this)">
                    ${dot}
                    <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
                        <span style="font-size:1.5rem;">${iconText}</span>
                        <div>
                            <div style="font-weight:bold; font-size:1rem; color:${unread ? '#fff' : '#ccc'};">${m.title}</div>
                            <div style="font-size:0.75rem; color:#888;">${date}</div>
                        </div>
                    </div>
                    <div style="font-size:0.9rem; color:#ccc; line-height:1.4;">
                        ${m.body}
                    </div>
                </div>
            `;
        });
        container.innerHTML = html;
    },

    markMessageRead: async function(msgId, el) {
        // Optimistic UI update
        el.style.background = 'rgba(255,255,255,0.03)';
        el.style.borderLeft = '3px solid transparent';
        el.style.opacity = '0.8';
        const dot = el.querySelector('div[style*="border-radius:50%"]');
        if (dot) dot.remove();
        
        // Remove click listener after read
        el.onclick = null;
        
        // Update badge optimistically
        const badge = document.getElementById('nav-unread-badge');
        if (badge && badge.style.display !== 'none') {
            let countStr = badge.textContent.replace('+', '');
            let count = parseInt(countStr);
            if (!isNaN(count) && count > 0) {
                count--;
                if (count === 0) badge.style.display = 'none';
                else badge.textContent = count;
            }
        }

        try {
            await fetch('/api/user/messages/read', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ msg_id: msgId })
            });
        } catch(e) { console.error("Error marking read:", e); }
    },

    openModal: async function (targetTab) {
        targetTab = targetTab || 'info';
        const modal = document.getElementById('profile-modal');
        if (!modal) return;
        modal.classList.remove('hidden');
        document.querySelectorAll('.dropdown-menu').forEach(d => d.classList.remove('show'));
        document.getElementById('profile-content-area').innerHTML = '<p style="text-align:center;padding:40px;">Cargando Perfil Élite...</p>';

        try {
            const res = await fetch('/api/profile');
            const data = await res.json();
            if (data.status === 'ok') {
                this.currentProfile = data.profile;
                this.renderProfile();
                setTimeout(() => {
                    const tabs = document.querySelectorAll('.profile-tab');
                    if (targetTab === 'themes' && tabs[2]) tabs[2].click();
                    else if (targetTab === 'trophies' && tabs[3]) tabs[3].click();
                    else if (targetTab === 'missions' && tabs[4]) tabs[4].click();
                    else if (tabs[0]) tabs[0].click();
                }, 60);
            } else {
                document.getElementById('profile-content-area').innerHTML = `<p style="text-align:center;color:red;">Error: ${data.message}</p>`;
            }
        } catch (e) {
            console.error(e);
            document.getElementById('profile-content-area').innerHTML = `<p style="text-align:center;color:red;">Error de red.</p>`;
        }
    },

    closeModal: function () {
        const m = document.getElementById('profile-modal');
        if (m) m.classList.add('hidden');
    },

    showMissionToast: function(missions) {
        if (!missions || missions.length === 0) return;
        const m = missions[0]; // Show the first newly completable mission
        const toast = document.getElementById('mission-toast');
        if (!toast) return;
        document.getElementById('mission-toast-icon').textContent = m.icon || '🎯';
        document.getElementById('mission-toast-name').textContent = `${m.name} — Nivel ${m.level}/3`;
        document.getElementById('mission-toast-rewards').textContent = `Recompensa: ${m.bits_reward > 0 ? '+' + m.bits_reward + ' Bits' : ''} ${m.xp_reward > 0 ? '+' + m.xp_reward + ' XP' : ''}`.trim();
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
        toast.style.pointerEvents = 'auto';
        // Allow user to click to go to missions
        toast.onclick = () => {
            UserProfileManager.openModal('missions');
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(30px)';
            toast.style.pointerEvents = 'none';
        };
        // Auto-hide after 5 seconds
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(30px)';
            toast.style.pointerEvents = 'none';
        }, 5000);
    },

    renderProfile: function () {
        const p = this.currentProfile;
        const area = document.getElementById('profile-content-area');
        if (!area) return;

        const frameId = p.marco_actual || p.avatar_frame || 'none';
        const hasFrame = frameId && frameId !== 'none' && frameId !== 'default';
        const frameHtml = hasFrame
            ? `<div class="frame-overlay frame-${frameId}" style="background-image:url('/static/img/frames/${frameId}.png');" onerror="this.style.display='none'"></div>` : '';
        const avatarHtml = p.photo_url
            ? `<img src="${p.photo_url}" class="avatar-image">`
            : `<div class="avatar-image" style="background:#333;display:flex;align-items:center;justify-content:center;font-size:2rem;">👤</div>`;

        const formatPlayTime = (mins) => {
            if (!mins) return "0 min";
            if (mins < 60) return `${mins} min`;
            const hours = Math.floor(mins / 60);
            const rMins = mins % 60;
            return rMins > 0 ? `${hours}h ${rMins}m` : `${hours}h`;
        };

        const winRatio = p.win_ratio !== undefined ? `${p.win_ratio}%` : '0%';
        const playedTime = formatPlayTime(p.tiempo_jugado);

        const lastTrophy = (p.trophies && p.trophies.length > 0)
            ? [...p.trophies].sort((a,b) => new Date(b.unlocked_at) - new Date(a.unlocked_at))[0]
            : null;

        area.innerHTML = `
            <div class="dashboard-header">
                <div class="dh-avatar-section" style="position:relative; display:flex; flex-direction:column; align-items:center;">
                    <div class="avatar-container" style="position:relative;">
                        ${avatarHtml}
                        ${hasFrame ? `<img
                            src="/static/img/frames/${frameId}.png"
                            class="frame-img"
                            alt="marco"
                            onerror="this.style.display='none'"
                        >` : ''}
                        <div class="level-badge-pill">Nv. ${p.progress.level}</div>
                        ${lastTrophy ? `
                        <!-- Mini Trophy Badge attached to avatar -->
                        <div class="last-trophy-avatar-badge" title="Último Trofeo: ${lastTrophy.name}" style="position:absolute; bottom:15%; right:-15px; z-index:10; background:radial-gradient(circle, #2a2a2a 0%, #111 100%); border:2px solid #c9a227; border-radius:50%; width:32px; height:32px; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 10px rgba(0,0,0,0.8), 0 0 10px rgba(201,162,39,0.5);">
                            <img src="/static/img/trophies/${lastTrophy.id}.png" style="width:18px; height:18px; object-fit:contain; filter: drop-shadow(0 2px 2px rgba(0,0,0,0.5));" onerror="this.src='/static/img/trophies/trophy_1.png'">
                        </div>
                        ` : ''}
                    </div>
                </div>
                <div class="dh-info-section">
                    <div class="dh-name-row">
                        <h3 class="profile-name">${p.nombre}</h3>
                        <span class="dh-telegram-id">ID: ${p.id || 'N/A'}</span>
                    </div>
                    <div class="profile-rank-badge"><span>${p.rank.icon}</span> ${p.rank.full_name || p.rank.name}</div>
                    <div class="xp-container">
                        <div class="xp-label">
                            <span>XP: ${p.progress.current_xp}</span>
                            <span>Sig. Nivel: ${p.progress.next_xp}</span>
                        </div>
                        <div class="xp-bar-bg"><div class="xp-bar-fill" style="width:${p.progress.percent}%"></div></div>
                    </div>
                </div>
            </div>

            <div class="stats-grid-dashboard">
                <div class="stat-box-d"><span class="stat-value">${playedTime}</span><span class="stat-label">Tiempo Jugado</span></div>
                <div class="stat-box-d"><span class="stat-value">${winRatio}</span><span class="stat-label">Win Rate</span></div>
                <div class="stat-box-d"><span class="stat-value">${p.juegos_jugados||0}</span><span class="stat-label">Partidas</span></div>
                <div class="stat-box-d"><span class="stat-value">${p.wins_total||0}</span><span class="stat-label">Victorias</span></div>
                <div class="stat-box-d"><span class="stat-value">${p.jackpots_ganados||0}</span><span class="stat-label">Jackpots</span></div>
            </div>

            <div style="display:flex;gap:10px;margin-bottom:20px;">
                <button class="btn-primary" style="flex:1" onclick="UserProfileManager.claimDailyReward()">🎁 Recompensa Diaria</button>
            </div>

            <div class="profile-tabs custom-scrollbar" style="overflow-x:auto; white-space:nowrap; padding-bottom:10px; margin-bottom:15px;">
                <button class="profile-tab active" onclick="UserProfileManager.switchTab('info',this)">⚙️ General</button>
                <button class="profile-tab tab-highlight" onclick="UserProfileManager.switchTab('trophies',this)">🏆 Trofeos</button>
                <button class="profile-tab tab-highlight" onclick="UserProfileManager.switchTab('missions',this)">🎯 Misiones</button>
                <button class="profile-tab" onclick="UserProfileManager.switchTab('sports',this)">⚽ Apuestas</button>
                <button class="profile-tab" onclick="UserProfileManager.switchTab('frames',this)">🖼️ Marcos</button>
                <button class="profile-tab" onclick="UserProfileManager.switchTab('themes',this)">🎨 Temas</button>
            </div>

            <!-- TAB: GENERAL INFO -->
            <div id="tab-info" class="tab-content active">
                <div class="settings-panel">
                    <h4 style="color:var(--gold-lt);margin-bottom:15px; border-bottom:1px solid rgba(255,215,0,0.2); padding-bottom:5px;">Ajustes de Perfil</h4>
                    <label style="color:#aaa; font-size:0.85rem; display:block; margin-bottom:5px;">Nombre Público</label>
                    <div style="display:flex;gap:10px; margin-bottom:5px;">
                        <input type="text" id="profile-edit-name" class="form-control" value="${p.nombre}" maxlength="20" style="flex:1;">
                        <button class="btn-secondary" onclick="UserProfileManager.updateName()">Guardar</button>
                    </div>
                    <small style="color:#888; display:block; margin-bottom:20px;">Este nombre será visible para otros jugadores en las tablas de clasificación y salas online. <span style="color:#f59e0b; font-weight:bold;">💰 Costo: 1,000 bits reales.</span></small>
                    
                    <h4 style="color:var(--gold-lt);margin-bottom:15px; border-bottom:1px solid rgba(255,215,0,0.2); padding-bottom:5px; margin-top:20px;">Acciones de Cuenta</h4>
                    <button class="btn-secondary" style="width:100%; border-color:#d32f2f; color:#ffeded; background:rgba(211,47,47,0.1);" onclick="window.Telegram?.WebApp?.close()">Cerrar Juego Totalmente</button>
                </div>
            </div>

            <!-- OTHER TABS -->
            <div id="tab-trophies" class="tab-content"><div class="trophy-grid" id="grid-trophies"><p style="text-align:center;color:#888;padding:20px;">Cargando Trofeos...</p></div></div>
            <div id="tab-missions" class="tab-content"><div class="missions-list" id="list-missions"><p style="text-align:center;color:#888;padding:20px;">Cargando Misiones...</p></div></div>
            <div id="tab-sports" class="tab-content"><div class="sports-list" id="list-sports"><p style="text-align:center;color:#888;padding:20px;">Cargando Apuestas...</p></div></div>
            <div id="tab-frames" class="tab-content"><div class="items-grid" id="grid-frames"></div></div>
            <div id="tab-themes" class="tab-content"><div class="items-grid" id="grid-themes"></div></div>
        `;

        this.renderInventory();
    },

    switchTab: function (tabName, btn) {
        document.querySelectorAll('.profile-tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        if (btn) btn.classList.add('active');
        const tab = document.getElementById('tab-' + tabName);
        if (tab) tab.classList.add('active');
        if (tabName === 'trophies') this.loadTrophies();
        if (tabName === 'missions') this.loadMissions();
        if (tabName === 'sports') this.loadSportsHistory();
    },

    loadSportsHistory: async function() {
        const grid = document.getElementById('list-sports');
        if (!grid) return;
        
        const tgId = this.currentProfile.id;
        if (!tgId) return;

        grid.innerHTML = '<p style="text-align:center;color:#888;padding:20px;">Cargando historial deportivo...</p>';
        try {
            const res = await fetch(`/sports/api/bets/${tgId}`);
            const bets = await res.json();
            if(!bets || bets.length === 0) {
                grid.innerHTML = '<p style="text-align:center;color:#888;padding:20px;">No has realizado apuestas deportivas aún.</p>';
                return;
            }
            grid.innerHTML = '';
            bets.forEach(b => {
                const el = document.createElement("div");
                el.style.cssText = "background:rgba(255,255,255,0.05); padding:15px; border-radius:8px; margin-bottom:10px; border:1px solid rgba(255,255,255,0.1);";
                let statusColor = b.status === 'won' ? '#10b981' : (b.status === 'lost' ? '#ef4444' : '#f59e0b');
                let statusText = b.status === 'won' ? 'Ganada' : (b.status === 'lost' ? 'Perdida' : 'Pendiente');
                el.innerHTML = `
                  <div style="display:flex; justify-content:space-between; margin-bottom: 5px;">
                    <strong>${b.match}</strong>
                    <span style="color: ${statusColor}; font-weight: bold;">${statusText}</span>
                  </div>
                  <div style="display:flex; justify-content:space-between; font-size: 0.9em; opacity: 0.8;">
                    <span>Opción: <strong style="color: var(--gold-1)">${b.choice}</strong></span>
                    <span>Apuesta: ${b.amount} bits</span>
                  </div>
                  <div style="font-size: 0.8em; margin-top: 5px; opacity: 0.6;">Potencial: ${b.potential_win} bits · ${new Date(b.date).toLocaleString()}</div>
                `;
                grid.appendChild(el);
            });
        } catch(e) {
            grid.innerHTML = '<p style="text-align:center;color:red;padding:20px;">Error cargando historial.</p>';
        }
    },

    renderInventory: function () {
        const ALL_FRAMES = [
            {id:'bronze1',name:'Bronce I',req:1},{id:'bronze2',name:'Bronce II',req:2},{id:'bronze3',name:'Bronce III',req:3},
            {id:'silver1',name:'Plata I',req:4},{id:'silver2',name:'Plata II',req:6},{id:'silver3',name:'Plata III',req:8},
            {id:'gold1',name:'Oro I',req:10},{id:'gold2',name:'Oro II',req:12},{id:'gold3',name:'Oro III',req:14},
            {id:'diamond1',name:'Diamante I',req:16},{id:'diamond2',name:'Diamante II',req:18},{id:'diamond3',name:'Diamante III',req:20},
            {id:'legendary1',name:'Legendario I',req:22},{id:'legendary2',name:'Legendario II',req:24},{id:'legendary3',name:'Legendario III',req:26}
        ];
        const ALL_THEMES = [
            {id:'default',name:'Moderno (Base)',req:1},{id:'dark_premium',name:'Dark Premium',req:7},
            {id:'gold_imperial',name:'Gold Imperial',req:13},{id:'las_vegas',name:'Las Vegas',req:19},{id:'noir',name:'Noir Élite',req:25}
        ];

        const myUnlocks = this.currentProfile.unlocked_items || [];
        const activeFrame = this.currentProfile.marco_actual || this.currentProfile.avatar_frame || 'none';
        const activeTheme = this.currentProfile.tema_actual || 'default';

        const fillGrid = (items, typeKey, activeId, containerId) => {
            const grid = document.getElementById(containerId);
            if (!grid) return;
            grid.innerHTML = '';
            items.forEach(item => {
                const isBase = item.req === 1;
                // Para los marcos, el desbloqueo depende 100% del nivel del usuario
                // Para los temas, dependemos de myUnlocks o del nivel
                let isUnlocked = false;
                if (typeKey === 'frame') {
                    isUnlocked = this.currentProfile.nivel >= item.req;
                } else {
                    isUnlocked = isBase || myUnlocks.some(u => u.type === typeKey && u.id === item.id);
                }
                
                const isEquipped = activeId === item.id;
                const div = document.createElement('div');
                div.className = `inventory-item${!isUnlocked?' locked':''}${isEquipped?' equipped':''}`;
                const previewHtml = typeKey === 'frame'
                    ? `<div class="item-frame-preview" style="background-image:url('/static/img/frames/${item.id}.png')"></div>`
                    : `<div class="item-icon">🎨</div>`;
                div.innerHTML = `
                    <div class="item-type-badge">Nv.${item.req}</div>
                    ${previewHtml}
                    <div class="item-name">${item.name}</div>
                    ${isEquipped ? '<div class="item-equipped-badge">✓ Equipado</div>' : ''}
                    ${!isUnlocked ? '<div class="item-lock-icon">🔒</div>' : ''}
                `;
                
                // Solo los temas se pueden equipar manualmente. Los marcos son automáticos y fijos.
                if (typeKey === 'theme' && isUnlocked && !isEquipped) {
                    div.onclick = () => this.equipItem(typeKey, item.id);
                } else if (typeKey === 'frame') {
                    div.style.cursor = 'default';
                }
                
                grid.appendChild(div);
            });
        };

        fillGrid(ALL_FRAMES, 'frame', activeFrame, 'grid-frames');
        fillGrid(ALL_THEMES, 'theme', activeTheme, 'grid-themes');
    },

    loadTrophies: async function () {
        const grid = document.getElementById('grid-trophies');
        if (!grid) return;
        try {
            const res = await fetch('/api/trophies');
            const data = await res.json();
            if (data.status === 'ok') this._renderTrophyGrid(data.trophies, grid);
        } catch(e) { grid.innerHTML = '<p style="color:red;text-align:center">Error</p>'; }
    },

    _renderTrophyGrid: function (trophies, container) {
        const unlocked = trophies.filter(t=>t.unlocked).length;
        let html = `<div class="trophies-summary"><span class="trophy-count">${unlocked}/${trophies.length}</span><span class="trophy-count-label">Trofeos Desbloqueados</span></div><div class="trophy-grid-inner">`;
        trophies.forEach(t => {
            html += `<div class="trophy-card ${t.unlocked?'unlocked':'locked'}" title="${t.desc}">
                <div class="trophy-img-wrap">
                    <img src="${t.img}" alt="${t.name}" class="trophy-img">
                    ${!t.unlocked?'<div class="trophy-lock-overlay">🔒</div>':''}
                </div>
                <div class="trophy-name">${t.name}</div>
                <div class="trophy-desc">${t.desc}</div>
                ${t.unlocked?'<div class="trophy-unlocked-badge">✓ Desbloqueado</div>':''}
            </div>`;
        });
        container.innerHTML = html + '</div>';
    },

    loadMissions: async function () {
        const list = document.getElementById('list-missions');
        if (!list) return;
        try {
            const res = await fetch('/api/missions');
            const data = await res.json();
            if (data.status === 'ok') {
                this.currentMissions = data.missions; // Store for filtering
                this.activeMissionFilter = this.activeMissionFilter || 'all';
                this._renderMissionList(this.currentMissions, list);
            }
        } catch(e) { list.innerHTML = '<p style="color:red;text-align:center">Error</p>'; }
    },

    _renderMissionList: function (missions, container) {
        let html = '';
        
        // 1. Filter UI
        const filters = [
            { id: 'all', name: 'Todas' },
            { id: 'moche', name: 'Moche' },
            { id: 'slot', name: 'Slots' },
            { id: 'ruleta', name: 'Ruleta' },
            { id: 'general', name: 'Globales' }
        ];

        let filterHtml = '<div style="display:flex; gap:8px; overflow-x:auto; padding-bottom:10px; margin-bottom:10px; border-bottom:1px solid rgba(255,215,0,0.2); white-space:nowrap; scrollbar-width:none;">';
        filters.forEach(f => {
            const active = this.activeMissionFilter === f.id ? 'background:var(--gold); color:#000;' : 'background:rgba(255,255,255,0.05); color:#ccc; border:1px solid rgba(255,215,0,0.3);';
            filterHtml += `<button onclick="UserProfileManager.filterMissions('${f.id}')" style="padding:6px 12px; border-radius:20px; font-size:0.8rem; font-weight:bold; cursor:pointer; transition:0.2s; ${active}">${f.name}</button>`;
        });
        filterHtml += '</div>';

        // 2. Apply Filter
        let filtered = missions;
        if (this.activeMissionFilter !== 'all') {
            filtered = missions.filter(m => m.id.startsWith(this.activeMissionFilter) || (this.activeMissionFilter === 'general' && (m.id.startsWith('racha_') || m.id.startsWith('diversidad_') || m.id.startsWith('torneo_'))));
        }

        // 3. Smart Sort: Ready to claim > In progress > Fully Claimed
        filtered.sort((a, b) => {
            const getScore = (m) => {
                if (m.claimed) return 3; // Fully done -> bottom
                if (m.completed) return 1; // Ready to claim -> top
                return 2; // In progress -> middle
            };
            const scoreA = getScore(a);
            const scoreB = getScore(b);
            if (scoreA !== scoreB) return scoreA - scoreB;
            // If same status, sort by progress percentage descending
            return b.progress_percent - a.progress_percent;
        });

        // 4. Progress Summary
        const totalMissions = missions.length;
        const fullyClaimed = missions.filter(m => m.claimed).length;
        html += filterHtml;
        html += `<div style="text-align:center; font-size:0.8rem; color:#888; margin-bottom:12px;">Progreso Total: <strong style="color:var(--gold);">${fullyClaimed}/${totalMissions}</strong> misiones completadas</div>`;
        
        let listHtml = '<div style="display:flex; flex-direction:column; gap:10px;">';
        filtered.forEach(m => {
            // m.claimed is true ONLY IF ALL 3 LEVELS ARE CLAIMED now (based on backend logic).
            // m.completed means THIS LEVEL is ready to claim.
            const cls = m.claimed ? 'mission-claimed' : (m.completed ? 'mission-completed' : 'mission-active');
            
            let btn = '';
            if (m.claimed) {
                btn = '<span class="mission-badge-claimed">✓ Completada</span>';
            } else if (m.completed) {
                btn = `<button class="mission-claim-btn" style="animation: pulseDiag 1.5s infinite;" onclick="UserProfileManager.claimMission('${m.id}',this)">🎁 Reclamar Nivel ${m.level}</button>`;
            } else {
                btn = `<span class="mission-progress-text">${m.current_progress}/${m.target}</span>`;
            }

            // Compact Design Update
            listHtml += `<div class="mission-card ${cls}" style="padding:10px; gap:10px;">
                <div class="mission-icon" style="font-size:1.6rem; width:36px;">${m.icon}</div>
                <div class="mission-body">
                    <div class="mission-name" style="font-size:0.85rem; display:flex; justify-content:space-between; align-items:center;">
                        ${m.name} 
                        <span style="font-size:0.65rem; color:var(--gold); border:1px solid var(--gold-hover); padding:1px 5px; border-radius:8px; background:rgba(212,175,55,0.1);">Nv.${m.level}/3</span>
                    </div>
                    <div class="mission-desc" style="font-size:0.7rem; margin-bottom:4px;">${m.desc}</div>
                    <div class="mission-rewards" style="margin-bottom:6px; gap:4px;">
                        ${m.xp_reward>0?`<span class="reward-badge xp" style="font-size:0.65rem; padding:1px 6px;">+${m.xp_reward} XP</span>`:''}
                        ${m.bits_reward>0?`<span class="reward-badge bits" style="font-size:0.65rem; padding:1px 6px;">+${m.bits_reward} Bits</span>`:''}
                    </div>
                    ${!m.claimed ? `<div class="mission-progress-bar-bg" style="height:4px;"><div class="mission-progress-bar-fill" style="width:${m.progress_percent}%"></div></div>` : ''}
                </div>
                <div class="mission-action" style="min-width:70px;">${btn}</div>
            </div>`;
        });
        listHtml += '</div>';

        container.innerHTML = html + (filtered.length > 0 ? listHtml : '<p style="text-align:center;color:#888; margin-top:20px;">No hay misiones en esta categoría.</p>');
    },

    filterMissions: function(filterId) {
        this.activeMissionFilter = filterId;
        const list = document.getElementById('list-missions');
        if (list && this.currentMissions) {
            this._renderMissionList(this.currentMissions, list);
        }
    },

    claimMission: async function (missionId, btn) {
        if (btn) btn.disabled = true;
        try {
            const res = await fetch('/api/missions/claim', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({mission_id: missionId})
            });
            const data = await res.json();
            if (data.status==='ok') {
                if (window.Telegram) window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
                const bitsEl = document.getElementById('global-bits-display');
                if (bitsEl && data.bits) bitsEl.innerText = data.bits;
                if (data.profile_updates) this.checkLevelUp(data.profile_updates);
                this.loadMissions();
            } else {
                if (btn) btn.disabled = false;
                alert(data.message);
            }
        } catch(e) { if(btn) btn.disabled=false; console.error(e); }
    },

    equipItem: async function (type, id) {
        try {
            const res = await fetch('/api/profile/equip', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({type, id})
            });
            const data = await res.json();
            if (data.status==='ok') {
                if (window.Telegram) window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
                if (type==='frame') {
                    this.currentProfile.avatar_frame = id;
                    this.currentProfile.marco_actual = id;
                    const hf = document.querySelector('.elite-avatar-wrap .avatar-frame');
                    if (hf) hf.className = `avatar-frame frame-${id}`;
                }
                if (type==='theme') { this.currentProfile.tema_actual = id; this.applyTheme(id); }
                this.renderProfile();
            } else { alert(data.message); }
        } catch(e) { console.error(e); }
    },

    updateName: async function () {
        const input = document.getElementById('profile-edit-name');
        if (!input) return;
        const newName = input.value.trim();
        if (newName.length < 3 || newName.length > 20) { alert("El nombre debe tener entre 3 y 20 caracteres."); return; }
        
        // Confirmar el costo
        const confirmed = confirm(`⚠️ Cambiar tu nombre público cuesta 1,000 bits reales.\n\n¿Deseas continuar?`);
        if (!confirmed) return;
        
        try {
            const res = await fetch('/api/profile/update_name', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({name: newName})
            });
            const data = await res.json();
            if (data.status==='ok') {
                alert(`✅ Nombre actualizado correctamente.\n💰 Se descontaron 1,000 bits reales.`);
                this.currentProfile.nombre = data.name;
                // Actualizar display de bits reales en la página
                if (data.bits !== undefined) {
                    const bitsEl = document.getElementById('global-bits-display');
                    if (bitsEl) bitsEl.innerText = data.bits.toLocaleString();
                }
                const hn = document.querySelector('.elite-name');
                if (hn) hn.innerText = data.name;
                this.renderProfile();
            } else { alert(data.message); }
        } catch(e) { console.error(e); }
    },

    claimDailyReward: async function () {
        try {
            const res = await fetch('/api/profile/daily_reward', {method:'POST'});
            const data = await res.json();
            if (data.status==='ok') {
                alert(`¡Felicidades! Has reclamado ${data.reward} Bits. Racha actual: ${data.streak} días.`);
                const bitsEl = document.getElementById('global-bits-display');
                if (bitsEl) bitsEl.innerText = data.bits_actuales;
                this.openModal('info');
            } else { alert(data.message); }
        } catch(e) { console.error(e); }
    },

    openPublicProfile: async function (userId) {
        // Use the opponent profile modal if it exists, otherwise create one
        let modal = document.getElementById('opponent-profile-modal');
        if (!modal) {
            modal = document.getElementById('profile-modal');
            if (!modal) return;
        }
        modal.classList.remove('hidden');
        const area = modal.querySelector('.modal-body') || document.getElementById('profile-content-area');
        if (area) area.innerHTML = '<p style="text-align:center;padding:40px;">Cargando Perfil...</p>';

        try {
            const res = await fetch(`/api/profile/${userId}`);
            const data = await res.json();
            if (data.status==='ok') {
                const p = data.profile;
                const frameId = p.marco || 'none';
                const hasFrame = frameId && frameId !== 'none' && frameId !== 'default';
                const frameHtml = hasFrame ? `<div class="frame-overlay frame-${frameId}" style="background-image:url('/static/img/frames/${frameId}.png')"></div>` : '';
                const avatarHtml = p.photo_url
                    ? `<img src="${p.photo_url}" class="avatar-image">`
                    : `<div class="avatar-image" style="background:#333;display:flex;align-items:center;justify-content:center;font-size:2rem;">👤</div>`;

                let trophyHtml = '<p style="color:#888;font-size:0.85rem;text-align:center;padding:10px">Sin trofeos aún</p>';
                if (p.trophies && p.trophies.length > 0) {
                    trophyHtml = `<div class="trophy-grid-public">${p.trophies.map(t=>`
                        <div class="trophy-card-sm" title="${t.name}: ${t.desc}">
                            <img src="${t.img}" alt="${t.name}" class="trophy-img-sm" onerror="this.outerHTML='<div style=\"font-size:2rem\">🏆</div>'">
                            <div class="trophy-name-sm">${t.name}</div>
                        </div>`).join('')}</div>`;
                }

                if (area) area.innerHTML = `
                    <div class="profile-header-card">
                        <div class="level-badge">${p.nivel}</div>
                        <div class="avatar-container">${frameHtml}${avatarHtml}</div>
                        <div class="profile-info">
                            <h3 class="profile-name">${p.nombre}</h3>
                            <div class="profile-rank-badge"><span>${p.rank_icon||'🎖️'}</span> ${p.rango}</div>
                            <div class="xp-container">
                                <div class="xp-label">
                                    <span>XP: ${p.xp}</span>
                                    <span>${p.wins_total||0} Victorias</span>
                                </div>
                                <div class="xp-bar-bg"><div class="xp-bar-fill" style="width:${p.progress?p.progress.percent:0}%"></div></div>
                            </div>
                        </div>
                    </div>
                    <div class="stats-grid">
                        <div class="stat-box"><span class="stat-value">${p.jackpots_ganados}</span><span class="stat-label">Jackpots</span></div>
                        <div class="stat-box"><span class="stat-value">${p.moches_ganados}</span><span class="stat-label">Moches</span></div>
                        <div class="stat-box"><span class="stat-value">${p.ruletas_ganadas}</span><span class="stat-label">Ruletas</span></div>
                        <div class="stat-box"><span class="stat-value">${p.wins_total||0}</span><span class="stat-label">Total Wins</span></div>
                    </div>
                    <div class="trophies-section-public">
                        <h4 class="section-title-sm">🏆 Trofeos</h4>
                        ${trophyHtml}
                    </div>`;
            } else {
                if(area) area.innerHTML = `<p style="text-align:center;color:red;">No se pudo cargar el perfil.</p>`;
            }
        } catch(e) { console.error(e); if(area) area.innerHTML='<p style="text-align:center;color:red;">Error de red.</p>'; }
    },

    applyTheme: function (t) {
        document.body.setAttribute('data-casino-theme', t);
        document.documentElement.setAttribute('data-casino-theme', t);
        localStorage.setItem('casino_theme', t);
    },
    loadSavedTheme: function () {
        const t = localStorage.getItem('casino_theme');
        if (t) {
            document.body.setAttribute('data-casino-theme', t);
            document.documentElement.setAttribute('data-casino-theme', t);
        }
    },

    checkLevelUp: function (pu) {
        if (!pu) return;
        if (pu.leveled_up) {
            this.showLevelUpBanner(pu.new_level, pu.rank_info, pu.unlocks);
            if(window.CasinoAudio) window.CasinoAudio.playSfx('win_big');
            if(window.Telegram) window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
            this.currentProfile = null;
        }
        if (pu.new_trophies && pu.new_trophies.length>0) this.showTrophyToasts(pu.new_trophies);
    },

    showTrophyToasts: function (trophies) {
        let delay = 0;
        trophies.forEach(t => { setTimeout(() => this._showOneTrophyToast(t), delay); delay += 3500; });
    },

    _showOneTrophyToast: function (trophy) {
        const toast = document.getElementById('trophy-toast');
        if (!toast) return;
        document.getElementById('trophy-toast-img').src = trophy.img || '';
        document.getElementById('trophy-toast-name').innerText = '🏆 ' + trophy.name;
        document.getElementById('trophy-toast-desc').innerText = trophy.desc;
        toast.classList.remove('hidden');
        toast.classList.add('show');
        setTimeout(() => { toast.classList.remove('show'); setTimeout(()=>toast.classList.add('hidden'),400); }, 3500);
    },

    showLevelUpBanner: function (level, rankInfo, unlocks) {
        const banner = document.getElementById('level-up-banner');
        if (!banner) return;
        document.getElementById('lu-title').innerText = `¡NIVEL ${level} ALCANZADO!`;
        document.getElementById('lu-icon').innerText = rankInfo.icon;
        document.getElementById('lu-desc').innerText = rankInfo.full_name || rankInfo.name;
        const ud = document.getElementById('lu-unlocks');
        ud.innerHTML = (unlocks&&unlocks.length>0) ? '<strong>'+unlocks.join('<br>')+'</strong>' : '';
        banner.classList.add('show');
        setTimeout(() => banner.classList.remove('show'), 5000);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    UserProfileManager.init();
    UserProfileManager.loadSavedTheme();
});

if (typeof window.toggleDropdown === 'undefined') {
    window.toggleDropdown = function (id) {
        const d = document.getElementById(id);
        if (d) d.classList.toggle('show');
    };
    document.addEventListener('click', function (e) {
        if (!e.target.closest('.dropdown'))
            document.querySelectorAll('.dropdown-menu').forEach(d => d.classList.remove('show'));
    });
}

/**
 * Global helper: Call this from any game page after receiving a response from /bet, /win or /api/spin.
 * data should be the parsed JSON response object.
 * Example: checkMissionNotifications(data);
 */
window.checkMissionNotifications = function(data) {
    if (data && data.newly_completed_missions && data.newly_completed_missions.length > 0) {
        if (window.UserProfileManager) {
            UserProfileManager.showMissionToast(data.newly_completed_missions);
        }
    }
};

window.openRecargarBits = function () {
    const tg = window.Telegram?.WebApp;
    const tgid = tg?.initDataUnsafe?.user?.id || window.USER_DATA?.telegram_id || 'ID_DESCONOCIDO';
    const tguser = tg?.initDataUnsafe?.user?.username || window.USER_DATA?.username || 'Usuario';
    const msg = `Hola, quiero recargar Bits.\n\nID Telegram: ${tgid}\nUsuario: @${tguser}\n\n¿Cuántos Bits puedo comprar?`;
    const url = `https://t.me/antraxx_g59?text=${encodeURIComponent(msg)}`;
    try { navigator.clipboard.writeText(msg); } catch(e) {}
    if (tg && tg.openTelegramLink) tg.openTelegramLink(url);
    else window.open(url, '_blank');
    document.querySelectorAll('.dropdown-menu').forEach(d => d.classList.remove('show'));
};
