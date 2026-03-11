/**
 * UserProfileManager - Frontend
 * Handles fetching, rendering profile, and level up popups.
 * Includes: Trophies, Missions, Public Profile, Level-Up Banner.
 */

window.UserProfileManager = {
    currentProfile: null,

    init: function () {
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

        area.innerHTML = `
            <div class="profile-header-card">
                <div class="level-badge">${p.progress.level}</div>
                <div class="avatar-container">${frameHtml}${avatarHtml}</div>
                <div class="profile-info">
                    <h3 class="profile-name">${p.nombre}</h3>
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
            <div class="stats-grid">
                <div class="stat-box"><span class="stat-value">${p.juegos_jugados||0}</span><span class="stat-label">Jugados</span></div>
                <div class="stat-box"><span class="stat-value">${p.jackpots_ganados||0}</span><span class="stat-label">Jackpots</span></div>
                <div class="stat-box"><span class="stat-value">${p.total_ganados||0}</span><span class="stat-label">Bits Ganados</span></div>
                <div class="stat-box"><span class="stat-value">${p.wins_total||0}</span><span class="stat-label">Total Wins</span></div>
            </div>
            <div style="display:flex;gap:10px;margin-bottom:20px;">
                <button class="btn-primary" style="flex:1" onclick="UserProfileManager.claimDailyReward()">🎁 Recompensa Diaria</button>
            </div>
            <div class="profile-tabs">
                <button class="profile-tab active" onclick="UserProfileManager.switchTab('info',this)">⚙️ Config.</button>
                <button class="profile-tab" onclick="UserProfileManager.switchTab('frames',this)">🖼️ Marcos</button>
                <button class="profile-tab" onclick="UserProfileManager.switchTab('themes',this)">🎨 Temas</button>
                <button class="profile-tab tab-highlight" onclick="UserProfileManager.switchTab('trophies',this)">🏆 Trofeos</button>
                <button class="profile-tab tab-highlight" onclick="UserProfileManager.switchTab('missions',this)">🎯 Misiones</button>
            </div>
            <div id="tab-info" class="tab-content active">
                <div style="background:rgba(255,255,255,0.05);padding:15px;border-radius:8px;">
                    <h4 style="color:var(--gold-lt);margin-bottom:10px;">Cambiar Nombre</h4>
                    <div style="display:flex;gap:10px;">
                        <input type="text" id="profile-edit-name" class="form-control" value="${p.nombre}" maxlength="20" style="flex:1;">
                        <button class="btn-secondary" onclick="UserProfileManager.updateName()">Guardar</button>
                    </div>
                    <small style="color:#aaa;display:block;margin-top:5px;">Entre 3 y 20 caracteres.</small>
                </div>
            </div>
            <div id="tab-frames" class="tab-content"><div class="items-grid" id="grid-frames"></div></div>
            <div id="tab-themes" class="tab-content"><div class="items-grid" id="grid-themes"></div></div>
            <div id="tab-trophies" class="tab-content"><div class="trophy-grid" id="grid-trophies"><p style="text-align:center;color:#888;padding:20px;">Cargando...</p></div></div>
            <div id="tab-missions" class="tab-content"><div class="missions-list" id="list-missions"><p style="text-align:center;color:#888;padding:20px;">Cargando...</p></div></div>
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
                const isUnlocked = isBase || myUnlocks.some(u => u.type === typeKey && u.id === item.id);
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
                if (isUnlocked && !isEquipped) div.onclick = () => this.equipItem(typeKey, item.id);
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
            if (data.status === 'ok') this._renderMissionList(data.missions, list);
        } catch(e) { list.innerHTML = '<p style="color:red;text-align:center">Error</p>'; }
    },

    _renderMissionList: function (missions, container) {
        let html = '';
        missions.forEach(m => {
            const cls = m.claimed ? 'mission-claimed' : (m.completed ? 'mission-completed' : 'mission-active');
            const btn = m.claimed
                ? '<span class="mission-badge-claimed">✓ Reclamado</span>'
                : (m.completed
                    ? `<button class="mission-claim-btn" onclick="UserProfileManager.claimMission('${m.id}',this)">🎁 Reclamar</button>`
                    : `<span class="mission-progress-text">${m.current_progress}/${m.target}</span>`);
            html += `<div class="mission-card ${cls}">
                <div class="mission-icon">${m.icon}</div>
                <div class="mission-body">
                    <div class="mission-name">${m.name}</div>
                    <div class="mission-desc">${m.desc}</div>
                    <div class="mission-rewards">
                        ${m.xp_reward>0?`<span class="reward-badge xp">+${m.xp_reward} XP</span>`:''}
                        ${m.bits_reward>0?`<span class="reward-badge bits">+${m.bits_reward} Bits</span>`:''}
                    </div>
                    <div class="mission-progress-bar-bg"><div class="mission-progress-bar-fill" style="width:${m.progress_percent}%"></div></div>
                </div>
                <div class="mission-action">${btn}</div>
            </div>`;
        });
        container.innerHTML = html || '<p style="text-align:center;color:#888">No hay misiones.</p>';
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
        try {
            const res = await fetch('/api/profile/update_name', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({name: newName})
            });
            const data = await res.json();
            if (data.status==='ok') {
                alert("Nombre actualizado correctamente");
                this.currentProfile.nombre = data.name;
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

    applyTheme: function (t) { document.body.setAttribute('data-casino-theme', t); localStorage.setItem('casino_theme', t); },
    loadSavedTheme: function () { const t=localStorage.getItem('casino_theme'); if(t) document.body.setAttribute('data-casino-theme', t); },

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
