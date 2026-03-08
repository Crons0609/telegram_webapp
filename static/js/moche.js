/**
 * MOCHE - JUEGO TRADICIONAL NICARAGÜENSE
 * Lógica del Cliente (JS)
 */

window.Telegram.WebApp.ready();
window.Telegram.WebApp.expand();

// ==========================================
// CONFIGURACIÓN Y ESTADO GLOBAL
// ==========================================
// ==========================================
// CONFIGURACIÓN Y ESTADO GLOBAL
// ==========================================
let supabaseClient = null;
let mocheChannel = null;
let isMultiplayer = false;

// Configuración de Supabase
const SUPABASE_URL = "https://xwkfzntmdkfztaeeuxkd.supabase.co";
const SUPABASE_KEY = "sb_publishable_14fF1qcKEF2Dj9bnD9U6pw_kbrZSIBe";

function getMyId() {
    return (isMultiplayer && window.USER_DATA && window.USER_DATA.telegram_id) ? window.USER_DATA.telegram_id.toString() : 'human';
}

async function syncStateToNetwork() {
    if (isMultiplayer && window.USER_DATA.room_id) {
        // En lugar de Socket.IO, enviamos una acción REST al backend para validar, 
        // pero por ahora el servidor confía en el estado y lo actualiza en DB
        fetch('/api/moche/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'sync',
                payload: { STATE }
            })
        });
    }
}

async function fetchRoomData(roomId) {
    if (!supabaseClient) return null;
    try {
        const { data: roomData, error: roomError } = await supabaseClient
            .from('rooms')
            .select('*')
            .eq('id', roomId)
            .single();

        if (roomError || !roomData) return null;

        const { data: playersData } = await supabaseClient
            .from('room_players')
            .select('*')
            .eq('room_id', roomId);

        // Convertir formato para mantener compatibilidad con UI anterior
        return {
            id: roomData.id,
            host: roomData.host_id,
            is_private: roomData.is_private,
            bet_amount: roomData.bet_amount,
            total_slots: roomData.max_players,
            difficulty: roomData.difficulty,
            bots_count: roomData.bots_count || 0,
            status: roomData.status,
            players: (playersData || []).map(p => ({
                id: p.player_id,
                name: p.player_name,
                avatar: p.avatar,
                frame: p.frame,
                is_host: p.is_host,
                ready: p.ready
            }))
        };
    } catch (e) { console.error(e); return null; }
}

async function fetchGameState(roomId) {
    if (!supabaseClient) return null;
    const { data: gsData } = await supabaseClient
        .from('game_state')
        .select('game_data')
        .eq('room_id', roomId)
        .single();
    if (gsData) return gsData.game_data;
    return null;
}

if (window.USER_DATA && window.USER_DATA.room_id) {
    isMultiplayer = true;
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    // Al cargar la página, obtener datos de la sala
    fetchRoomData(window.USER_DATA.room_id).then(room => {
        if (!room) {
            alert('Sala cerrada o no encontrada.');
            window.location.href = '/';
            return;
        }
        window.CURRENT_ROOM_DATA = room;
        actualizarSalaDeEspera(room);

        if (room.status === 'playing') {
            startLocalGameUI();
        }
    });

    // Suscribirse a cambios en tiempo real
    mocheChannel = supabaseClient.channel('moche_room_' + window.USER_DATA.room_id)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${window.USER_DATA.room_id}` }, payload => {
            fetchRoomData(window.USER_DATA.room_id).then(room => {
                if (room) {
                    window.CURRENT_ROOM_DATA = room;
                    actualizarSalaDeEspera(room);
                }
            });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${window.USER_DATA.room_id}` }, payload => {
            if (payload.eventType === 'DELETE') {
                alert('La sala ha sido cerrada por el anfitrión.');
                window.location.href = '/';
                return;
            }
            fetchRoomData(window.USER_DATA.room_id).then(room => {
                if (room) {
                    window.CURRENT_ROOM_DATA = room;
                    actualizarSalaDeEspera(room);
                    if (room.status === 'playing' && document.getElementById('waiting-room-overlay').classList.contains('hidden') === false) {
                        startLocalGameUI();
                    }
                }
            });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state', filter: `room_id=eq.${window.USER_DATA.room_id}` }, payload => {
            handleServerStateSync(payload.new.game_data);
        })
        .on('broadcast', { event: 'moche_events' }, payload => {
            const data = payload.payload;
            if (data.type === 'quick_message') {
                if (data.payload.sender && data.payload.msg) {
                    showChatToast(`💬 ${data.payload.sender}: ${data.payload.msg}`, document.getElementById('chat-toast'));
                }
            } else if (data.type === 'player_bet_increase') {
                if (data.payload.player_id !== getMyId()) {
                    STATE.apuestaActual = data.payload.new_total;
                    const pZone = getZoneByPlayerId(data.payload.player_id);
                    animarFichasAlCentro(data.payload.amount, pZone, false);
                    if (window.CasinoAudio) window.CasinoAudio.playSfx('chip_drop');
                }
            } else if (data.type === 'propose_raise') {
                manejarPropuestaAumento(data.payload.player_id, data.payload.amount);
            } else if (data.type === 'raise_response') {
                procesarRespuestaRaise(data.payload.player_id, data.payload.accepted);
            } else if (data.type === 'raise_resolved') {
                resolverRaise(data.payload.status, data.payload.amount, data.payload.proposer, data.payload.acceptors, data.payload.rejectorId);
            }
        })
        .subscribe();
}

function startLocalGameUI() {
    document.getElementById('difficulty-modal').classList.add('hidden');
    document.getElementById('waiting-room-overlay').classList.add('hidden');

    if (window.CasinoAudio) {
        window.CasinoAudio.initAudioContext();
        window.CasinoAudio.playBGM('bgm_moche');
    }
    fetchGameState(window.USER_DATA.room_id).then(state => {
        if (state) handleServerStateSync(state);
    });
}

function handleServerStateSync(serverState) {
    if (!serverState) return;

    STATE.deck = serverState.deck;
    STATE.discardPile = serverState.discardPile;
    STATE.turnOrder = serverState.turnOrder;
    STATE.currentTurnIndex = serverState.currentTurnIndex;
    STATE.phase = serverState.phase;
    STATE.hasDrawn = serverState.hasDrawn;
    STATE.drawnCardRef = serverState.drawnCardRef;
    STATE.mustUseDiscard = serverState.mustUseDiscard;
    STATE.latestDiscardEnlarged = serverState.latestDiscardEnlarged;
    // Si la DB tiene info de apuesta/dificultad, lo actualiza el fetchRoomData, no el game_state normalmente
    // Pero asumiendo que el server oculta cartas de rivales (si es proxy):

    // Asegurarse de que serverState.players es un objeto
    if (!serverState.players) return;

    STATE.players = {};
    const uiOffsets = ['human', 'bot1', 'bot2', 'bot3'];
    let idx = 0;

    ['bot-1', 'bot-2', 'bot-3'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    const levelEmojis = { easy: '🟢', medium: '🟡', hard: '🔴', pro: '🔥' };
    const emoji = window.CURRENT_ROOM_DATA ? levelEmojis[window.CURRENT_ROOM_DATA.difficulty || 'easy'] : '🟢';

    for (let pid of STATE.turnOrder) {
        const serverPlayer = serverState.players[pid];
        if (!serverPlayer) continue;

        const isMe = String(pid) === getMyId();
        const mappedId = isMe ? 'human' : uiOffsets[++idx];

        STATE.players[pid] = {
            id: pid,
            name: serverPlayer.name,
            cards: serverPlayer.cards,
            bajadas: serverPlayer.bajadas,
            ui_zone: mappedId,
            is_bot: serverPlayer.is_bot || false
        };

        if (!isMe) {
            const zoneId = mappedId.replace('bot', 'bot-');
            const zoneEl = document.getElementById(zoneId);
            if (zoneEl) {
                zoneEl.style.display = '';
                const infoEl = zoneEl.querySelector('.player-info');
                if (infoEl) infoEl.textContent = `${emoji} ${serverPlayer.name}`;
            }
        }
    }

    if (window.USER_DATA && window.USER_DATA.bits !== undefined) {
        updateBitsUI(window.USER_DATA.bits);
    }

    if (STATE.phase === 'INTERCAMBIO') {
        iniciarFaseIntercambio();
    } else if (STATE.phase === 'BAJADA_INICIAL') {
        iniciarBajadaInicial();
    } else if (STATE.phase === 'JUEGO') {
        procesarTurno();
    } else if (STATE.phase === 'INTERCEPT') {
        procesarCircuito();
    }

    actualizarBotonesJuego();
    renderMesa();
}

window.kickPlayer = function (targetId) {
    if (confirm("¿Seguro que quieres expulsar a este jugador?")) {
        fetch('/api/moche/kick', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target_id: targetId })
        }).then(r => r.json()).then(res => {
            if (res.status === 'error') alert(res.message);
        });
    }
};

function actualizarSalaDeEspera(room) {
    if (room.status !== 'waiting') {
        // Game started!
        document.getElementById('waiting-room-overlay').classList.add('hidden');
        document.getElementById('difficulty-modal').classList.add('hidden'); // Also hide the difficult screen
        return;
    }

    const wrOverlay = document.getElementById('waiting-room-overlay');
    wrOverlay.classList.remove('hidden');

    document.getElementById('wr-subtitle').innerText = `Apuesta: ${room.bet_amount} Bits · Bots: ${room.bots_count}`;

    // ── ROOM CODE DISPLAY ──────────────────────────────────────────────────────
    const codeContainer = document.getElementById('wr-code-container');
    const codeDisplay = document.getElementById('wr-room-code');
    if (codeContainer && codeDisplay) {
        codeContainer.classList.remove('hidden');
        codeDisplay.textContent = room.id.toUpperCase();
    }

    // Lista de Jugadores
    const me = room.players.find(p => p.id === window.USER_DATA.telegram_id);
    const listHtml = room.players.map(p => {
        const isMeObj = p.id === window.USER_DATA.telegram_id;
        const canKick = me && me.is_host && !isMeObj;

        const avatarUrl = p.avatar || '/static/img/usuario.png';
        const frameClass = p.frame ? 'frame-' + p.frame : 'frame-none';

        return `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 8px; border: 1px solid rgba(201,162,39,0.3);">
            <div style="display:flex; align-items:center; gap: 10px;">
                <span style="font-size: 1.2rem;">${p.is_host ? '👑' : '👤'}</span>
                <div class="elite-avatar-wrap" style="width: 32px; height: 32px; position:relative; flex-shrink:0;">
                    <img src="${avatarUrl}" class="elite-avatar-img" style="width:100%; height:100%; border-radius:50%; object-fit:cover; border:1px solid rgba(201,162,39,0.5);">
                    <div class="elite-frame ${frameClass}" style="position:absolute; top:50%; left:50%; width:140%; height:140%; transform:translate(-50%, -50%); background-size:contain; background-repeat:no-repeat; background-position:center;"></div>
                </div>
                <span style="font-weight: bold; color: #fff;">${p.name}</span>
            </div>
            <div style="display:flex; align-items:center; gap: 10px;">
                <span style="font-size: 0.85rem; padding: 4px 8px; border-radius: 12px; background: ${p.ready ? 'rgba(0,255,0,0.2)' : 'rgba(255,170,0,0.2)'}; color:${p.ready ? '#0f0' : '#fa0'}">${p.ready ? 'Listo' : 'Esperando...'}</span>
                ${canKick ? `<button onclick="window.kickPlayer('${p.id}')" style="background:transparent; border:none; color:#ff4444; font-size:1.2rem; cursor:pointer;" title="Expulsar">❌</button>` : ''}
            </div>
        </div>
        `;
    }).join('') + `
        <div style="margin-top:10px; border-top:1px solid #333; padding-top:10px; font-size:0.85em; color:#aaa;">
            La sala requiere mímino 2 jugadores reales para iniciar (incluyendo bots). Actuales: ${room.players.length + room.bots_count}/${room.total_slots}
        </div>
    `;
    document.getElementById('wr-players-list').innerHTML = listHtml;

    // Botones (Host Start vs Player Ready)
    const btnAction = document.getElementById('wr-btn-action');
    btnAction.classList.remove('hidden');

    if (me && me.is_host) {
        btnAction.innerText = 'Iniciar Partida';
        const allOthersReady = room.players.every(p => p.id === me.id || p.ready);
        const hasMinimumPlayers = room.players.length >= 2 || room.total_slots > 0;
        btnAction.disabled = !allOthersReady;
        btnAction.onclick = () => { fetch('/api/moche/start', { method: 'POST' }); };
    } else {
        btnAction.innerText = me && me.ready ? 'Cancelar Listo' : '¡Estoy Listo!';
        btnAction.disabled = false;
        btnAction.onclick = () => { fetch('/api/moche/ready', { method: 'POST' }); };
    }

    // ── SHARE BUTTON ───────────────────────────────────────────────────────────
    // IMPORTANT: set BOT_USERNAME to your actual Telegram bot username
    const BOT_USERNAME = 'Zona_Jackpot_777bot';
    const shareBtn = document.getElementById('wr-btn-share');
    if (room.is_private) {
        shareBtn.classList.remove('hidden');
        shareBtn.onclick = () => {
            const tg = window.Telegram?.WebApp;
            // Telegram startapp deep link — works from any Telegram client, even outside the WebApp
            const deepLink = `https://t.me/${BOT_USERNAME}?startapp=room_${room.id}`;
            const shareText = `🎰 ¡Te invito a mi mesa privada de *Moche Premium*!\n\n🔑 Código: *${room.id.toUpperCase()}*\n💰 Apuesta: ${room.bet_amount} Bits\n\nPulsa el enlace para entrar directamente:`;
            const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(deepLink)}&text=${encodeURIComponent(shareText)}`;

            if (tg) {
                tg.openTelegramLink(shareUrl);
            } else {
                // Fallback: copy to clipboard
                navigator.clipboard.writeText(`${shareText}\n${deepLink}`).then(() => {
                    alert(`Enlace copiado:\n${deepLink}`);
                }).catch(() => {
                    alert(`Comparte este código: ${room.id.toUpperCase()}\nEnlace: ${deepLink}`);
                });
            }
        };
    } else {
        shareBtn.classList.add('hidden');
    }
}

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const VALUES = { 'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 };

const STATE = {
    deck: [],
    discardPile: [],
    players: {
        human: { id: 'human', name: 'Tú', cards: [], bajadas: [], is_bot: false },
        bot1: { id: 'bot1', name: 'Bot 1', cards: [], bajadas: [], is_bot: true },
        bot2: { id: 'bot2', name: 'Bot 2', cards: [], bajadas: [], is_bot: true },
        bot3: { id: 'bot3', name: 'Bot 3', cards: [], bajadas: [], is_bot: true }
    },
    turnOrder: ['human', 'bot1', 'bot2', 'bot3'],
    currentTurnIndex: 0,
    phase: 'INIT', // INIT, APUESTA, REPARTO, INTERCAMBIO, BAJADA_INICIAL, JUEGO, INTERCEPT, FIN
    selectedCardsIndices: [],
    selectedTableCards: [], // { ownerId, grupoIndex, cardIndex }
    hasDrawn: false,
    drawnCardRef: null,
    difficulty: 'easy',      // 'easy' | 'medium' | 'hard' | 'pro'
    numBots: 3,              // 1-3, set on difficulty selection
    mustUseDiscard: false,
    latestDiscardEnlarged: false,
    drawnCardAnim: '',
    apuestaActual: 50,
    pendingReturnToIndex: null, // Tráfico de regreso tras extensión de grupo
    interceptState: null, // { offeredTo: playerIndex, discardedByIndex: number, awaitingDiscard: false }
    pendingRaise: null // { proposer: 'human', amount: 150, responses: {}, required: [] }
};

// ==========================================
// ELEMENTOS DEL DOM
// ==========================================
const DOM = {
    bitsDisplay: document.getElementById('global-bits-display'),
    deckPile: document.getElementById('deck-pile'),
    deckCount: document.getElementById('deck-count'),
    discardPile: document.getElementById('discard-pile'),
    humanCards: document.getElementById('human-cards'),
    humanBajadas: document.getElementById('human-bajadas'),
    bot1Cards: document.getElementById('bot-1-cards'),
    bot1Bajadas: document.getElementById('bot-1-bajadas'),
    bot2Cards: document.getElementById('bot-2-cards'),
    bot2Bajadas: document.getElementById('bot-2-bajadas'),
    bot3Cards: document.getElementById('bot-3-cards'),
    bot3Bajadas: document.getElementById('bot-3-bajadas'),
    drawnCardZone: document.getElementById('drawn-card-zone'),
    drawnSlot: document.getElementById('drawn-slot'),
    btnIntercambio: document.getElementById('btn-intercambio'),
    btnPasar: document.getElementById('btn-pasar'),
    btnBajar: document.getElementById('btn-bajar'),
    btnListo: document.getElementById('btn-listo'),
    btnTomar: document.getElementById('btn-tomar'),
    btnMocheColor: document.getElementById('btn-moche-color'),
    turnIndicator: document.getElementById('turn-indicator'),
    turnText: document.getElementById('turn-text'),
    turnTimer: document.getElementById('turn-timer'),
    turnTimerBar: document.getElementById('turn-timer-bar'),
    overlay: document.getElementById('game-overlay'),
    overlayTitle: document.getElementById('overlay-title'),
    overlayMessage: document.getElementById('overlay-message'),
    overlayBtn: document.getElementById('overlay-btn'),
    raiseModal: document.getElementById('raise-modal'),
    raiseMessage: document.getElementById('raise-message'),
    raiseAmountText: document.getElementById('raise-amount-text'),
    btnRaiseAccept: document.getElementById('btn-raise-accept'),
    btnRaiseReject: document.getElementById('btn-raise-reject'),
    raiseTimerBar: document.getElementById('raise-timer-bar')
};

// ==========================================
// INICIALIZACIÓN
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
    if (isMultiplayer) {
        // En modo multijugador, la sala de espera manda. Ocultamos el modal de dificultad local.
        const diffModal = document.getElementById('difficulty-modal');
        if (diffModal) diffModal.classList.add('hidden');

        // La tabla principal se muestra vacía hasta que el Server mande el estado JUEGO
    } else {
        // Mostrar modal de dificultad primero (Modo un jugador)
        initDifficultyModal();
    }

    DOM.overlayBtn.addEventListener('click', () => {
        DOM.overlay.classList.add('hidden');
        if (STATE.phase === 'INIT' || STATE.phase === 'FIN') {
            iniciarPartida();
        }
    });

    DOM.btnIntercambio.addEventListener('click', realizarIntercambio);
    DOM.btnListo.addEventListener('click', terminarBajadaInicial);
    DOM.btnPasar.addEventListener('click', pasarTurnoHumano);
    DOM.btnBajar.addEventListener('click', intentarBajarMoche);
    DOM.btnTomar.addEventListener('click', humanoTomaDescarteIntercept);
    if (DOM.btnMocheColor) DOM.btnMocheColor.addEventListener('click', botarTodoMocheColor);

    // Click en la baraja para robar
    DOM.deckPile.addEventListener('click', robarDelMazo);
    DOM.discardPile.addEventListener('click', robarDelDescarte);

    // Initialise Betting system
    initBettingButtons();

    // Quick Chat
    initQuickChat();
    // (alerta de bienvenida se lanza desde startGameAfterDifficulty)
});

// ==========================================
// MODAL DE DIFICULTAD
// ==========================================
const DIFFICULTY_CONFIG = {
    easy: { apuesta: 50, numBots: () => 1 + Math.floor(Math.random() * 2), aiBase: 0.45, label: 'Fácil' },
    medium: { apuesta: 150, numBots: () => 2 + Math.floor(Math.random() * 2), aiBase: 0.65, label: 'Media' },
    hard: { apuesta: 350, numBots: () => 3, aiBase: 0.80, label: 'Difícil' },
    pro: { apuesta: 700, numBots: () => 3, aiBase: 0.92, label: 'Profesional' },
};

function initDifficultyModal() {
    const modal = document.getElementById('difficulty-modal');
    if (!modal) { startGameAfterDifficulty('easy'); return; }
    document.querySelectorAll('.diff-card').forEach(btn => {
        btn.addEventListener('click', () => {
            const level = btn.dataset.level;
            modal.style.animation = 'diff-fade-in 0.3s ease reverse both';
            setTimeout(() => {
                modal.classList.add('hidden');
                startGameAfterDifficulty(level);
            }, 280);
        });
    });
}

function startGameAfterDifficulty(level) {
    const cfg = DIFFICULTY_CONFIG[level] || DIFFICULTY_CONFIG.easy;
    STATE.difficulty = level;
    STATE.numBots = Math.min(3, Math.max(1, cfg.numBots()));
    STATE.apuestaActual = cfg.apuesta;

    // Aplicar tema de mesa
    const tableEl = document.getElementById('moche-table');
    if (tableEl) tableEl.dataset.difficulty = level;

    // Construir turnOrder dinámico
    const allBots = ['bot1', 'bot2', 'bot3'];
    const activeBots = allBots.slice(0, STATE.numBots);
    STATE.turnOrder = ['human', ...activeBots];

    // Mostrar/ocultar zonas de bots
    const botZoneMap = { bot1: 'bot-1', bot2: 'bot-2', bot3: 'bot-3' };
    allBots.forEach(bid => {
        const zoneEl = document.getElementById(botZoneMap[bid]);
        if (zoneEl) zoneEl.style.display = activeBots.includes(bid) ? '' : 'none';
    });

    // Assign ui_zone so renderMesa() can correctly map each player to a DOM zone
    STATE.players['human'].ui_zone = 'human';
    STATE.players['human'].is_bot = false;
    activeBots.forEach((bid, i) => {
        STATE.players[bid].ui_zone = bid; // 'bot1', 'bot2', 'bot3'
        STATE.players[bid].is_bot = true;  // CRITICAL: mark as bot so procesarTurno fires jugarTurnoBot
    });
    // Clear ui_zone and is_bot for inactive bots so they are skipped
    allBots.filter(b => !activeBots.includes(b)).forEach(bid => {
        STATE.players[bid].ui_zone = null;
        STATE.players[bid].is_bot = true; // still a bot structurally, but ui_zone=null means they are excluded from play
    });

    // Nombres personalizados para los bots activos
    const botNames = ['Karla', 'Miguel', 'Sofía'];
    const levelEmojis = { easy: '🟢', medium: '🟡', hard: '🔴', pro: '🔥' };
    const emoji = levelEmojis[level];
    activeBots.forEach((bid, i) => {
        STATE.players[bid].name = botNames[i] || `Bot ${i + 1}`;
        const infoEl = document.querySelector(`#${botZoneMap[bid]} .player-info`);
        if (infoEl) infoEl.textContent = `${emoji} ${STATE.players[bid].name}`;
    });

    mostrarAlerta(
        `${emoji} Moche ${cfg.label}`,
        `${STATE.numBots} bot${STATE.numBots > 1 ? 's' : ''} · Apuesta: ${cfg.apuesta} Bits. ¡Listo para jugar?`,
        'Jugar'
    );
}

// ==========================================
// FUNCIONES DE ALERTA Y API
// ==========================================
function mostrarAlerta(titulo, mensaje, textoBoton = 'Continuar') {
    DOM.overlayTitle.innerText = titulo;
    DOM.overlayMessage.innerText = mensaje;
    DOM.overlayBtn.innerText = textoBoton;
    DOM.overlay.classList.remove('hidden');
}

function updateBitsUI(bits) {
    if (DOM.bitsDisplay) DOM.bitsDisplay.innerText = bits;
    window.USER_DATA.bits = bits;
}

// ==========================================
// LÓGICA DE CARTAS
// ==========================================
function crearMazo() {
    let mazo = [];
    for (let suit of SUITS) {
        for (let rank of RANKS) {
            mazo.push({ suit, rank, value: VALUES[rank], isRed: suit === '♥' || suit === '♦' });
        }
    }
    return mazo.sort(() => Math.random() - 0.5);
}

function iniciarPartida() {
    // Validar si tiene bits suficientes para apostar
    if (window.USER_DATA.bits < STATE.apuestaActual) {
        mostrarAlerta('Fondos insuficientes', `Necesitas al menos ${STATE.apuestaActual} Bits para jugar.`, 'Entendido');
        return;
    }

    // Descontar apuesta llamando al backend
    fetch('/bet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cantidad: STATE.apuestaActual, source: 'moche' })
    })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'ok') {
                if (data.profile_updates && window.UserProfileManager) window.UserProfileManager.checkLevelUp(data.profile_updates);
                updateBitsUI(data.bits);
                prepararMesa();
            } else {
                mostrarAlerta('Error', data.message || 'No se pudo apostar.', 'Cerrar');
            }
        })
        .catch(console.error);
}

function prepararMesa() {
    STATE.deck = crearMazo();
    STATE.discardPile = [];
    STATE.drawnCard = null;

    // Vaciar manos y bajadas
    for (let key in STATE.players) {
        STATE.players[key].cards = [];
        STATE.players[key].bajadas = [];
    }

    STATE.phase = 'REPARTO';
    STATE.selectedTableCards = [];
    STATE.latestDiscardEnlarged = false;

    // Calcular pozo inicial incluyendo a bots
    const playersIds = STATE.turnOrder;
    const totalApostado = STATE.apuestaActual * playersIds.length;

    // Animar las fichas de todos los jugadores al centro
    document.getElementById('pot-chips').innerHTML = ''; // Limpiar previo
    playersIds.forEach((pid, index) => {
        const pZone = getZoneByPlayerId(pid);
        setTimeout(() => {
            animarFichasAlCentro(STATE.apuestaActual, pZone);
        }, index * 250);
    });
    // Multiplicamos the state amount tracking as well, for syncing
    STATE.apuestaActual = totalApostado;

    // Mostrar controles de apuesta extras
    document.getElementById('betting-controls')?.classList.remove('hidden');

    if (window.CasinoAudio) {
        window.CasinoAudio.initAudioContext();
        window.CasinoAudio.playBGM('bgm_moche');
    }

    repartirCartas();
}

function repartirCartas() {
    let dealInterval = setInterval(() => {
        let allDealt = true;
        let cardDealtThisFrame = false;

        for (let key of STATE.turnOrder) {
            if (STATE.players[key].cards.length < 9) {
                STATE.players[key].cards.push(STATE.deck.pop());
                allDealt = false;
                cardDealtThisFrame = true;
            }
        }

        if (cardDealtThisFrame && window.CasinoAudio) window.CasinoAudio.playSfx('card_slide');

        renderMesa();

        if (allDealt) {
            clearInterval(dealInterval);

            // Check for instant win conditions in order
            if (!verificarMocheDeMano()) {
                if (!verificarMocheDeColor()) {
                    iniciarFaseIntercambio();
                }
            }
        }
    }, 100); // Animación en intervalo
}

// Verifica si algún jugador recibe 4 cartas idénticas (Moche de Mano) al repartir
function verificarMocheDeMano() {
    for (let key of STATE.turnOrder) {
        const player = STATE.players[key];
        const rankCounts = {};

        for (let card of player.cards) {
            rankCounts[card.rank] = (rankCounts[card.rank] || 0) + 1;
            if (rankCounts[card.rank] === 4) {
                // Moche de Mano encontrado!
                STATE.phase = 'FIN';
                renderMesa();

                const alertMsg = key === 'human'
                    ? `¡Felicidades! Has recibido cuatro cartas de ${card.rank} ("Moche de Mano"). ¡Ganas la partida automáticamente!`
                    : `El jugador ${player.name} ha recibido cuatro cartas de ${card.rank} ("Moche de Mano") y gana la partida.`;

                mostrarAlerta('Moche de Mano', alertMsg, 'Volver a Jugar');
                return true;
            }
        }
    }
    return false;
}

/**
 * Verifica Moche de Color: si todas las cartas del jugador son del mismo color (todas rojas o todas negras).
 * El humano recibe la opción de botar todas para ganar. Si un bot lo tiene, gana automáticamente.
 */
function verificarMocheDeColor() {
    for (let key of STATE.turnOrder) {
        const player = STATE.players[key];
        if (!player.cards || player.cards.length === 0) continue;

        const allRed = player.cards.every(c => c.isRed);
        const allBlack = player.cards.every(c => !c.isRed);

        if (allRed || allBlack) {
            const colorName = allRed ? 'rojas (\u2665\u2666)' : 'negras (\u2660\u2663)';

            if (key === 'human') {
                // El humano puede elegir botar todo para ganar
                STATE.phase = 'MOCHE_COLOR';
                renderMesa();
                mostrarAlerta(
                    '\ud83c\udf08 \u00a1Moche de Color!',
                    `\u00a1Todas tus cartas son ${colorName}! Presiona el botón morado para botarlas todas y ganar la partida.`,
                    'Entendido'
                );
                DOM.overlayBtn.onclick = () => {
                    DOM.overlay.classList.add('hidden');
                    DOM.overlayBtn.onclick = null;
                    DOM.btnMocheColor.classList.remove('hidden');
                };
                return true;
            } else {
                // Un bot tiene Moche de Color — gana automáticamente
                STATE.phase = 'FIN';
                renderMesa();
                document.getElementById('betting-controls')?.classList.add('hidden');

                const premio = STATE.apuestaActual * 6;
                const winnerUIZone = getZoneByPlayerId(key);
                animarPremioAlGanador(premio, winnerUIZone);

                setTimeout(() => {
                    mostrarAlerta(
                        '\ud83c\udf08 Moche de Color del Oponente',
                        `${player.name} recibió todas cartas ${colorName} y gana la partida automáticamente por ${premio} Bits.`,
                        'Volver a Jugar'
                    );
                }, 1500);
                return true;
            }
        }
    }
    return false;
}

function botarTodoMocheColor() {
    if (STATE.phase !== 'MOCHE_COLOR') return;
    const humanPlayer = STATE.players['human'] || STATE.players[getMyId()];
    if (!humanPlayer) return;

    // Botar todas las cartas al descarte una por una (animar)
    const cards = [...humanPlayer.cards];
    humanPlayer.cards = [];
    STATE.discardPile.push(...cards);
    DOM.btnMocheColor.classList.add('hidden');
    renderMesa();

    // Declarar victoria
    setTimeout(() => ganarPartidaMocheDeColor(), 400);
}

function ganarPartidaMocheDeColor() {
    STATE.phase = 'FIN';
    const premio = STATE.apuestaActual * 6; // Premio especial x6 por Moche de Color

    fetch('/win', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cantidad: premio, source: 'moche', multiplier: 6 })
    })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'ok') {
                if (data.profile_updates && window.UserProfileManager) window.UserProfileManager.checkLevelUp(data.profile_updates);
                updateBitsUI(data.bits);
                updateBitsUI(data.bits);
                const winnerUIZone = 'human'; // Siempre lo activa el humano
                animarPremioAlGanador(premio, winnerUIZone);
                document.getElementById('betting-controls')?.classList.add('hidden');

                setTimeout(() => {
                    mostrarAlerta(
                        '\ud83c\udf08 \u00a1MOCHE DE COLOR!',
                        `\u00a1Bajaste todas tus cartas! Ganaste +${premio} Bits (multiplicador especial x6).`,
                        'Volver a Jugar'
                    );
                }, 1500);
            }
        });
}


function renderMesa() {
    DOM.deckCount.innerText = STATE.deck.length;

    // Renderizar descarte (Realistic Stack Effect)
    DOM.discardPile.innerHTML = '';
    if (STATE.discardPile.length > 0) {
        DOM.discardPile.classList.remove('empty-slot');

        // Show up to the last 5 cards in the discard pile to simulate a stack
        const stackSize = Math.min(5, STATE.discardPile.length);
        const startIndex = STATE.discardPile.length - stackSize;

        for (let i = 0; i < stackSize; i++) {
            const cardData = STATE.discardPile[startIndex + i];
            const isTopCard = (i === stackSize - 1);

            // Allow human to select top card if it's their turn
            const isSelectable = isTopCard && STATE.phase === 'JUEGO' && STATE.turnOrder[STATE.currentTurnIndex] === window.USER_DATA.telegram_id;

            const discardEl = crearElementoCarta(cardData, isSelectable);

            // Absolutely position all cards in the stack over each other
            discardEl.style.position = 'absolute';
            discardEl.style.top = '0';
            discardEl.style.left = '0';

            if (isTopCard) {
                // Top card logic
                discardEl.style.zIndex = 10;
                discardEl.style.transform = 'rotate(0deg)'; // Top card is straight
                if (STATE.latestDiscardEnlarged) {
                    discardEl.classList.add('enlarged');
                }
            } else {
                // Underlying cards logic (messy stack effect)
                // Use a deterministic pseudo random rotation based on the card string so it doesn't flicker on re-renders
                const seedStr = cardData.suit + cardData.value;
                let hash = 0;
                for (let k = 0; k < seedStr.length; k++) {
                    hash = seedStr.charCodeAt(k) + ((hash << 5) - hash);
                }
                const randomAngle = (hash % 20) - 10; // -10 to 10 degrees

                discardEl.style.zIndex = i;
                discardEl.style.transform = `rotate(${randomAngle}deg)`;
                // Dim the underlying cards slightly for depth
                discardEl.style.filter = 'brightness(0.85)';
            }

            DOM.discardPile.appendChild(discardEl);
        }
    } else {
        DOM.discardPile.classList.add('empty-slot');
    }

    // Mapa dinámico de zonas (incluye tanto modo local como multiplayer)
    // Extraemos .player-info parent nodes para actualizar los nombres
    const domZones = {
        'human': { cards: DOM.humanCards, bajadas: DOM.humanBajadas, info: document.querySelector('.player-controls .player-info') },
        'bot1': { cards: DOM.bot1Cards, bajadas: DOM.bot1Bajadas, info: document.querySelector('.bot-left .player-info') },
        'bot2': { cards: DOM.bot2Cards, bajadas: DOM.bot2Bajadas, info: document.querySelector('.bot-top .player-info') },
        'bot3': { cards: DOM.bot3Cards, bajadas: DOM.bot3Bajadas, info: document.querySelector('.bot-right .player-info') }
    };

    // Limpiar todas las zonas primero
    Object.values(domZones).forEach(z => {
        if (z.cards) z.cards.innerHTML = '';
        if (z.bajadas) z.bajadas.innerHTML = '';
    });

    // Renderizar a todos los jugadores según su ui_zone
    for (const pid of STATE.turnOrder) {
        const player = STATE.players[pid];
        if (!player || !player.ui_zone) continue;

        const zone = domZones[player.ui_zone];
        if (!zone) continue;

        // Actualizar el nombre mostrado del jugador/bot
        if (zone.info && player.name) {
            let displayName = player.ui_zone === 'human' ? `${player.name} (Tú)` : player.name;
            const emoji = player.is_bot ? '🤖 ' : '';
            displayName = emoji + displayName;

            if (!player.is_bot) {
                zone.info.setAttribute('data-player-id', player.id);
            } else {
                zone.info.removeAttribute('data-player-id');
            }

            if (player.avatar || player.frame) {
                const avatarUrl = player.avatar || '/static/img/usuario.png';
                const frameClass = player.frame ? 'frame-' + player.frame : 'frame-none';
                zone.info.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 6px; justify-content: center;">
                        <div class="elite-avatar-wrap" style="width: 24px; height: 24px; position:relative; flex-shrink:0;">
                            <img src="${avatarUrl}" class="elite-avatar-img" style="width:100%; height:100%; border-radius:50%; object-fit:cover; border:1px solid rgba(201,162,39,0.5);">
                            <div class="elite-frame ${frameClass}" style="position:absolute; top:50%; left:50%; width:140%; height:140%; transform:translate(-50%, -50%); background-size:contain; background-repeat:no-repeat; background-position:center;"></div>
                        </div>
                        <span>${displayName}</span>
                    </div>
                `;
            } else {
                zone.info.textContent = displayName;
            }
        }

        if (player.ui_zone === 'human') {
            // Lógica especial para mis cartas: mostramos caras, permitimos selección
            player.cards.forEach((card, index) => {
                const cardEl = crearElementoCarta(card, true);
                cardEl.dataset.index = index;
                if (STATE.selectedCardsIndices.includes(index)) {
                    cardEl.classList.add('selected');
                }
                cardEl.addEventListener('click', () => {
                    const currentIndex = Array.from(DOM.humanCards.children).indexOf(cardEl);
                    if (STATE.phase === 'INTERCAMBIO' || STATE.phase === 'JUEGO' || STATE.phase === 'INTERCEPT_DISCARD') {
                        seleccionarCartaHumano(currentIndex);
                    }
                });
                zone.cards.appendChild(cardEl);
            });
            // Init Drag n Drop
            initLocalCardDrag(player);
        } else {
            // Lógica para oponentes (bots o humanos remotos)
            renderBotHand(zone.cards, player.cards.length);
        }

        // Renderizar Bajadas
        renderBajadas(zone.bajadas, player.bajadas, player.ui_zone === 'human');
    }

    // Renderizar carta robada en su slot si existe
    DOM.drawnSlot.innerHTML = '';
    if (STATE.hasDrawn && STATE.drawnCardRef) {
        DOM.drawnCardZone.classList.remove('hidden');
        const drawnEl = crearElementoCarta(STATE.drawnCardRef, true, STATE.drawnCardAnim);
        STATE.drawnCardAnim = ''; // reset after applying once
        drawnEl.dataset.isDrawn = "true";
        if (STATE.selectedCardsIndices.includes("drawn")) {
            drawnEl.classList.add('selected');
        }
        drawnEl.addEventListener('click', () => {
            if (STATE.phase === 'JUEGO' || STATE.phase === 'INTERCEPT_DISCARD') {
                seleccionarCartaHumano("drawn");
            }
        });
        DOM.drawnSlot.appendChild(drawnEl);
        DOM.drawnSlot.classList.add('has-card');
    } else {
        DOM.drawnCardZone.classList.add('hidden');
        DOM.drawnSlot.classList.remove('has-card');
    }
}

function initLocalCardDrag(player) {
    if (!window.sortableHumanCards) {
        window.sortableHumanCards = new Sortable(DOM.humanCards, {
            animation: 50,  // minimal — avoids slide-in artifacts during card deal
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            delay: 80,
            delayOnTouchOnly: true,
            ghostClass: 'card-ghost',
            chosenClass: 'card-chosen',
            dragClass: 'card-drag',
            onEnd: function (evt) {
                // Sincronizar STATE usando 'player' directamente
                const cards = player.cards;
                const movedItem = cards.splice(evt.oldIndex, 1)[0];
                cards.splice(evt.newIndex, 0, movedItem);

                STATE.selectedCardsIndices = [];
                STATE.selectedTableCards = [];
                DOM.humanCards.querySelectorAll('.card.selected').forEach(el => el.classList.remove('selected'));

                actualizarBotonesJuego();
            }
        });
    }
}

function renderBajadas(container, bajadasArray, isHuman, ownerId) {
    container.innerHTML = '';

    bajadasArray.forEach((grupo, grupoIndex) => {
        const grpDiv = document.createElement('div');
        grpDiv.className = 'moche-group';

        // Auto-ordenar cartas del grupo de menor a mayor valor
        const sortedGrupo = [...grupo].sort((a, b) => a.value - b.value);

        const isHumanTurn = STATE.phase === 'JUEGO' && STATE.turnOrder[STATE.currentTurnIndex] === 'human';
        const isIntercept = STATE.phase === 'INTERCEPT_DISCARD';

        // Protección: si al dueño del grupo solo le queda 1 carta en mano,
        // nadie más puede agregar cartas a sus grupos (la última carta la gana él solo)
        const ownerCardCount = ownerId ? STATE.players[ownerId].cards.length : 99;
        const ownerIsAtFinalCard = ownerCardCount <= 1;

        // Si es el turno del humano (o en intercepción) y tiene cartas seleccionadas o una carta robada, el grupo se vuelve clickeable
        const canAddToGroup = !ownerIsAtFinalCard &&
            (isHumanTurn || isIntercept) &&
            (STATE.selectedCardsIndices.length > 0 || STATE.selectedTableCards.length > 0 || STATE.drawnCardRef !== null);

        if (canAddToGroup) {
            grpDiv.classList.add('interactive', 'highlight-target');
            grpDiv.addEventListener('click', () => {
                intentarAgregarAMoche(ownerId, grupoIndex);
            });
        }

        sortedGrupo.forEach((card, cardIndex) => {
            // Map sorted index back to original grupo index for selection tracking
            const originalIndex = grupo.indexOf(card);
            const isSelected = STATE.selectedTableCards.some(
                sel => sel.ownerId === ownerId && sel.grupoIndex === grupoIndex && sel.cardIndex === originalIndex
            );

            const cardEl = crearElementoCarta(card, false);
            if (isSelected) {
                cardEl.classList.add('selected');
            }

            if (isHumanTurn || isIntercept) {
                cardEl.classList.add('interactive');
                cardEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    toggleTableCardSelection(ownerId, grupoIndex, originalIndex);
                });
            }

            grpDiv.appendChild(cardEl);
        });
        container.appendChild(grpDiv);
    });
}


function toggleTableCardSelection(ownerId, grupoIndex, cardIndex) {
    const existingIdx = STATE.selectedTableCards.findIndex(
        sel => sel.ownerId === ownerId && sel.grupoIndex === grupoIndex && sel.cardIndex === cardIndex
    );

    if (existingIdx > -1) {
        STATE.selectedTableCards.splice(existingIdx, 1);
    } else {
        STATE.selectedTableCards.push({ ownerId, grupoIndex, cardIndex });
    }

    actualizarBotonesJuego();
    renderMesa();
}

function renderBotHand(container, count) {
    container.innerHTML = '';
    for (let i = 0; i < count; i++) {
        const div = document.createElement('div');
        div.className = 'card card-back';
        container.appendChild(div);
    }
}

function crearElementoCarta(cardObj, isInteractive = false, animClass = '') {
    const div = document.createElement('div');
    div.className = `card ${cardObj.isRed ? 'red' : 'black'}`;
    if (isInteractive) div.classList.add('interactive');
    if (animClass) div.classList.add(animClass);

    div.innerHTML = `
        <div class="corner-top"><span>${cardObj.rank}</span><span>${cardObj.suit}</span></div>
        <div class="center-suit">${cardObj.suit}</div>
        <div class="corner-bottom"><span>${cardObj.rank}</span><span>${cardObj.suit}</span></div>
    `;
    return div;
}

// ==========================================
// FASE 1: INTERCAMBIO (UNA SOLA VEZ)
// ==========================================
function iniciarFaseIntercambio() {
    STATE.phase = 'INTERCAMBIO';
    STATE.selectedCardsIndices = [];
    DOM.btnIntercambio.classList.remove('hidden');
    if (DOM.turnText) DOM.turnText.innerText = "Fase Inicial: Selecciona 1 carta para pasar a Bot 1 (Derecha)"; else DOM.turnIndicator.innerText = "Fase Inicial: Selecciona 1 carta para pasar a Bot 1 (Derecha)";
}

function seleccionarCartaHumano(index) {
    if (STATE.phase === 'INTERCAMBIO') {
        STATE.selectedCardsIndices = [index];
        renderMesa();
    } else if (STATE.phase === 'INTERCEPT_DISCARD' || STATE.phase === 'BAJADA_INICIAL' || (STATE.phase === 'JUEGO' && STATE.turnOrder[STATE.currentTurnIndex] === 'human')) {
        const pos = STATE.selectedCardsIndices.indexOf(index);
        if (pos > -1) {
            STATE.selectedCardsIndices.splice(pos, 1);
        } else {
            STATE.selectedCardsIndices.push(index);
        }
        // Al seleccionar cartas de la mano, limpiar las de la mesa por simplicidad si se prefiere,
        // pero aquí mantenemos ambas selecciones vivas para combinarlas.
        actualizarBotonesJuego();
        renderMesa();
    }
}

function actualizarBotonesJuego() {
    DOM.btnBajar.classList.add('hidden');
    DOM.btnPasar.classList.add('hidden');
    if (DOM.btnListo) DOM.btnListo.classList.add('hidden');

    // ── Fase de Bajada Inicial ──
    if (STATE.phase === 'BAJADA_INICIAL') {
        if (STATE.selectedCardsIndices.length >= 3) {
            DOM.btnBajar.classList.remove('hidden');
        }
        if (DOM.btnListo) DOM.btnListo.classList.remove('hidden');
        return;
    }

    // ── Turno del humano en JUEGO o INTERCEPT_DISCARD ──
    const isHumanTurn = STATE.phase === 'JUEGO' && STATE.turnOrder[STATE.currentTurnIndex] === 'human';
    const isIntercept = STATE.phase === 'INTERCEPT_DISCARD';

    if (!isHumanTurn && !isIntercept) return;

    // Bajar Moche: disponible en cualquier momento del turno si hay 3+ cartas seleccionadas (suma de mano y mesa)
    const numSelectedHand = STATE.selectedCardsIndices.length;
    const numSelectedTable = STATE.selectedTableCards.length;
    const totalSelected = numSelectedHand + numSelectedTable;

    if (totalSelected >= 3) {
        DOM.btnBajar.classList.remove('hidden');
        return; // Cuando se puede bajar, no se muestran botones de descarte simultáneamente
    }

    // Botones de descarte: solo después de robar
    if (STATE.hasDrawn) {
        if (totalSelected === 0) {
            DOM.btnPasar.innerText = "Pasar (Bota Robada)";
            DOM.btnPasar.classList.remove('hidden');
        } else if (numSelectedHand === 1 && numSelectedTable === 0 && STATE.selectedCardsIndices[0] !== "drawn") {
            DOM.btnPasar.innerText = "Botar (Robada a Mano)";
            DOM.btnPasar.classList.remove('hidden');
        }
    }
}

function realizarIntercambio() {
    if (STATE.selectedCardsIndices.length === 0) {
        window.Telegram.WebApp.showAlert("Debes seleccionar una carta para pasar.");
        return;
    }

    // Prepare passes using a map of player ID to the card they are passing
    const passes = {};
    const turnOrder = STATE.turnOrder; // dynamic, 2 to 4 players

    // Extract one card from each player
    for (const pid of turnOrder) {
        if (pid === getMyId() || pid === 'human') {
            // Human: take the selected card
            passes[pid] = STATE.players[pid].cards.splice(STATE.selectedCardsIndices[0], 1)[0];
        } else {
            // Bot: take a random card
            const pCards = STATE.players[pid].cards;
            if (pCards.length > 0) {
                const randomIdx = Math.floor(Math.random() * pCards.length);
                passes[pid] = pCards.splice(randomIdx, 1)[0];
            } else {
                console.warn(`Intercambio: Player ${pid} has no cards!`);
                passes[pid] = null;
            }
        }
    }

    // Pass the extracted card to the next player in the cycle (circular array shift right)
    for (let i = 0; i < turnOrder.length; i++) {
        const currentPid = turnOrder[i];
        // The one who receives is the NEXT player in the cycle -> currentPid gives to nextPid
        const nextIdx = (i + 1) % turnOrder.length;
        const nextPid = turnOrder[nextIdx];

        if (passes[currentPid]) {
            STATE.players[nextPid].cards.push(passes[currentPid]);
        }
    }

    DOM.btnIntercambio.classList.add('hidden');
    STATE.selectedCardsIndices = [];
    STATE.selectedTableCards = [];
    STATE.selectedCardIndex = null;

    // Transición directa a Bajada Inicial (sin modal)
    STATE.phase = 'BAJADA_INICIAL';
    iniciarBajadaInicial();
}

function iniciarBajadaInicial() {
    // Ocultar indicador de turno durante la fase de preparación
    if (DOM.turnText) DOM.turnText.innerText = ''; else DOM.turnIndicator.innerText = '';
    DOM.turnIndicator.style.display = 'none';

    // Solo mostrar botón de confirmación
    if (DOM.btnListo) DOM.btnListo.classList.remove('hidden');
    if (DOM.btnBajar) DOM.btnBajar.classList.remove('hidden');
    if (DOM.btnIntercambio) DOM.btnIntercambio.classList.add('hidden');
    if (DOM.btnPasar) DOM.btnPasar.classList.add('hidden');
    if (DOM.btnTomar) DOM.btnTomar.classList.add('hidden');

    renderMesa();
}

function terminarBajadaInicial() {
    STATE.phase = 'JUEGO';
    STATE.selectedCardsIndices = [];
    STATE.selectedTableCards = [];
    if (DOM.btnListo) DOM.btnListo.classList.add('hidden');
    if (DOM.btnBajar) DOM.btnBajar.classList.add('hidden');

    // Ocultar botones de apuesta extra (solo se permiten antes de empezar)
    document.getElementById('betting-controls')?.classList.add('hidden');

    // Restaurar indicador
    DOM.turnIndicator.style.display = '';
    STATE.currentTurnIndex = Math.floor(Math.random() * STATE.turnOrder.length);
    procesarTurno();
}

function esMocheValido(selectedCards) {
    // Restricción estricta de 3 o 4 cartas
    if (selectedCards.length < 3 || selectedCards.length > 4) {
        return false;
    }

    const isTercia = selectedCards.every(c => c.rank === selectedCards[0].rank);
    if (isTercia) return true;

    // Verificar Corrida (Escalera de color)
    let sorted = [...selectedCards].sort((a, b) => a.value - b.value);

    // Todos deben ser del mismo palo
    const isSameSuit = sorted.every(c => c.suit === sorted[0].suit);
    if (!isSameSuit) return false;

    // Validación estándar de secuencia (2-3-4, 5-6-7, 10-J-Q, etc.)
    const isCorrida = sorted.every((c, idx) => {
        if (idx === 0) return true;
        return c.value === sorted[idx - 1].value + 1;
    });
    if (isCorrida) return true;

    // Validación: As como carta ALTA (J-Q-K-A o Q-K-A)
    if (sorted[0].rank === 'A') {
        let modifiedSorted = [...sorted];
        let ace = modifiedSorted.shift();
        let pseudoAce = { ...ace, value: 14 };
        modifiedSorted.push(pseudoAce);

        const isHighAceCorrida = modifiedSorted.every((c, idx) => {
            if (idx === 0) return true;
            return c.value === modifiedSorted[idx - 1].value + 1;
        });
        if (isHighAceCorrida) return true;
    }

    // Validación: As como carta BAJA (A-2-3 o A-2-3-4)
    // El As ya tiene value=1 en el sistema, pero necesitamos verificar la secuencia 1-2-3-4
    if (sorted[0].rank === 'A') {
        // sorted ya está ordenado ascendente, A(1) al principio
        const isLowAceCorrida = sorted.every((c, idx) => {
            if (idx === 0) return true;
            return c.value === sorted[idx - 1].value + 1;
        });
        if (isLowAceCorrida) return true;
    }

    return false;
}


// ===== BAJAR MOCHE (HUMANO) =====
function intentarBajarMoche() {
    const isInicialPhase = STATE.phase === 'BAJADA_INICIAL';
    const isJuegoTurn = STATE.phase === 'JUEGO' && STATE.turnOrder[STATE.currentTurnIndex] === getMyId();
    const isIntercept = STATE.phase === 'INTERCEPT_DISCARD';
    if (!isInicialPhase && !isJuegoTurn && !isIntercept) return;

    if (STATE.selectedCardsIndices.length + STATE.selectedTableCards.length < 3) {
        window.Telegram.WebApp.showAlert("Un moche nuevo debe tener al menos 3 cartas.");
        return;
    }

    // 🚫 REGLA DE PROPIEDAD: al bajar un nuevo moche, solo puedes usar cartas DE TU MANO.
    // 🚫 REGLA DE PROPIEDAD
    const opponentCardSelected = STATE.selectedTableCards.some(sel => sel.ownerId !== getMyId());
    if (opponentCardSelected) {
        window.Telegram.WebApp.showAlert(
            "No puedes incluir cartas de los grupos de otros jugadores al bajar tu propio Moche. " +
            "Para extender el grupo de otro jugador, haz clic directamente en ese grupo en la mesa."
        );
        STATE.selectedCardsIndices = [];
        STATE.selectedTableCards = [];
        actualizarBotonesJuego();
        renderMesa();
        return;
    }

    const hasDrawnSel = STATE.selectedCardsIndices.includes("drawn");
    const indicesHand = STATE.selectedCardsIndices.filter(i => i !== "drawn").sort((a, b) => b - a);

    const selectedCards = indicesHand.map(i => STATE.players[getMyId()].cards[i]);
    if (hasDrawnSel) {
        selectedCards.push(STATE.drawnCardRef);
    }

    // Añadir cartas seleccionadas de la mesa
    const tableCardsToAdd = STATE.selectedTableCards.map(sel => STATE.players[sel.ownerId].bajadas[sel.grupoIndex][sel.cardIndex]);
    selectedCards.push(...tableCardsToAdd);

    if (esMocheValido(selectedCards)) {
        // DRY-RUN: Validar grupos origen
        const groupsToModify = new Map(); // key: "ownerId_grupoIndex", value: [indices to remove...]
        STATE.selectedTableCards.forEach(sel => {
            const key = `${sel.ownerId}_${sel.grupoIndex}`;
            if (!groupsToModify.has(key)) groupsToModify.set(key, []);
            groupsToModify.get(key).push(sel.cardIndex);
        });

        let sourceGroupsValid = true;
        for (let [key, indicesToRemove] of groupsToModify.entries()) {
            const [ownerId, grupoIndex] = key.split('_');
            const originalGroup = STATE.players[ownerId].bajadas[grupoIndex];

            // Crear una copia del grupo sin las cartas seleccionadas
            indicesToRemove.sort((a, b) => b - a); // Sort descending to remove safely
            const testGroup = [...originalGroup];
            indicesToRemove.forEach(idx => testGroup.splice(idx, 1));

            // Un grupo es válido si queda vacío (se consume entero) o si sus cartas restantes forman un moche válido
            if (testGroup.length > 0 && !esMocheValido(testGroup)) {
                sourceGroupsValid = false;
                break;
            }
        }

        if (!sourceGroupsValid) {
            window.Telegram.WebApp.showAlert("Esta jugada dejaría uno de los grupos de la mesa inválido. Revisa tu selección.");
            return;
        }

        // APLICAR CAMBIOS
        // 1. Remover de grupos origen
        for (let [key, indicesToRemove] of groupsToModify.entries()) {
            const [ownerId, grupoIndex] = key.split('_');
            indicesToRemove.sort((a, b) => b - a);
            indicesToRemove.forEach(idx => STATE.players[ownerId].bajadas[grupoIndex].splice(idx, 1));
        }

        // Limpiar grupos vacíos
        for (let ownerId in STATE.players) {
            STATE.players[ownerId].bajadas = STATE.players[ownerId].bajadas.filter(g => g.length > 0);
        }

        // 2. Remover de mano humana
        indicesHand.forEach(idx => STATE.players[getMyId()].cards.splice(idx, 1));
        if (hasDrawnSel) {
            STATE.drawnCardRef = null;
        }

        // 3. Añadir nuevo moche a las bajadas del humano
        STATE.players[getMyId()].bajadas.push(selectedCards);

        STATE.selectedCardsIndices = [];
        STATE.selectedTableCards = [];

        renderMesa();
        window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');

        // Victoria automática: 10 cartas en la mesa y 0 en la mano
        if (verificarVictoriaAuto(getMyId())) return;

        actualizarBotonesJuego();
        if (isJuegoTurn || isIntercept) {
            if (DOM.turnText) DOM.turnText.innerText = "Moche bajado. Selecciona una carta de tu mano para botar y terminar la interacción."; else DOM.turnIndicator.innerText = "Moche bajado. Selecciona una carta de tu mano para botar y terminar la interacción.";
            DOM.btnPasar.innerText = "Botar Carta";
            DOM.btnPasar.classList.remove('hidden');
        }
        syncStateToNetwork();
    } else {
        window.Telegram.WebApp.showAlert("Las cartas seleccionadas no forman un Moche válido (Tercia o Corrida).");
        STATE.selectedCardsIndices = [];
        STATE.selectedTableCards = [];
        actualizarBotonesJuego();
        renderMesa();
        syncStateToNetwork();
    }
}

// Detectar victoria automática: todas las cartas del jugador están en grupos en la mesa
function verificarVictoriaAuto(playerId) {
    const player = STATE.players[playerId];
    const cardsInHand = player.cards.length + (playerId === getMyId() && STATE.drawnCardRef ? 1 : 0);
    const cardsOnTable = player.bajadas.reduce((sum, g) => sum + g.length, 0);

    if (cardsOnTable >= 10 && cardsInHand === 0) {
        if (playerId === getMyId()) {
            ganarPartida();
        } else {
            renderMesa();
            mostrarAlerta('Fin del Juego',
                `¡${player.name} ha bajado todas sus cartas a la mesa y gana la partida!`,
                'Volver a Jugar');
            STATE.phase = 'FIN';
        }
        return true;
    }
    return false;
}


function intentarAgregarAMoche(ownerId, grupoIndex) {
    const isJuegoTurn = STATE.phase === 'JUEGO' && STATE.turnOrder[STATE.currentTurnIndex] === getMyId();
    const isIntercept = STATE.phase === 'INTERCEPT_DISCARD';
    if (!isJuegoTurn && !isIntercept) return;

    const targetGrupo = STATE.players[ownerId].bajadas[grupoIndex];
    if (!targetGrupo) return;

    const hasDrawnSel = STATE.selectedCardsIndices.includes("drawn");
    const indicesHand = STATE.selectedCardsIndices.filter(i => i !== "drawn").sort((a, b) => b - a);

    const selectedCards = indicesHand.map(i => STATE.players[getMyId()].cards[i]);

    // Si el jugador no ha seleccionado la carta robada explícitamente,
    // pero existe una carta robada, se incluye automáticamente al hacer clic en el grupo.
    const drawnIncluded = hasDrawnSel || (!hasDrawnSel && STATE.drawnCardRef !== null && indicesHand.length === 0 && STATE.selectedTableCards.length === 0);
    if (drawnIncluded && STATE.drawnCardRef) {
        selectedCards.push(STATE.drawnCardRef);
    }


    // Identificar si estamos intentando meter cartas de ESA MISMA BAJADA a sí misma.
    // Esto podría ser simplemente reorganizar el mismo grupo (arrastrar una carta de una esquina a otra, que aquí no hace falta, el grupo ya está ordenado lógicamente).
    // Si la bajada de destino también contiene cartas seleccionadas, lo evitamos por simplicidad.
    const destiniesTableSelection = STATE.selectedTableCards.some(sel => sel.ownerId === ownerId && sel.grupoIndex === grupoIndex);
    if (destiniesTableSelection) {
        window.Telegram.WebApp.showAlert("No puedes seleccionar cartas de un grupo de la mesa y agregarlas al mismo grupo.");
        STATE.selectedCardsIndices = [];
        STATE.selectedTableCards = [];
        actualizarBotonesJuego();
        renderMesa();
        return;
    }

    // Añadir cartas seleccionadas de la mesa (que pertenecen a OTROS grupos)
    const tableCardsToAdd = STATE.selectedTableCards.map(sel => STATE.players[sel.ownerId].bajadas[sel.grupoIndex][sel.cardIndex]);
    selectedCards.push(...tableCardsToAdd);

    // Unimos el grupo de la mesa con las cartas seleccionadas e intentamos validarlo
    const combined = [...targetGrupo, ...selectedCards];

    if (esMocheValido(combined)) {
        // DRY-RUN: Validar grupos origen
        const groupsToModify = new Map(); // key: "ownerId_grupoIndex", value: [indices to remove...]
        STATE.selectedTableCards.forEach(sel => {
            const key = `${sel.ownerId}_${sel.grupoIndex}`;
            if (!groupsToModify.has(key)) groupsToModify.set(key, []);
            groupsToModify.get(key).push(sel.cardIndex);
        });

        let sourceGroupsValid = true;
        for (let [key, indicesToRemove] of groupsToModify.entries()) {
            const [srcOwnerId, srcGrupoIndex] = key.split('_');
            const originalGroup = STATE.players[srcOwnerId].bajadas[srcGrupoIndex];

            // Crear copia sin las cartas
            indicesToRemove.sort((a, b) => b - a);
            const testGroup = [...originalGroup];
            indicesToRemove.forEach(idx => testGroup.splice(idx, 1));

            // Si el grupo se queda con 1 o 2 cartas o rompe secuencia, es inválido (a menos que se consuma totalmente = length 0)
            if (testGroup.length > 0 && !esMocheValido(testGroup)) {
                sourceGroupsValid = false;
                break;
            }
        }

        if (!sourceGroupsValid) {
            window.Telegram.WebApp.showAlert("Esta jugada dejaría uno de los grupos de la mesa inválido. Revisa tu selección.");
            return;
        }

        // APLICAR CAMBIOS
        // 1. Remover de grupos origen
        for (let [key, indicesToRemove] of groupsToModify.entries()) {
            const [srcOwnerId, srcGrupoIndex] = key.split('_');
            indicesToRemove.sort((a, b) => b - a);
            indicesToRemove.forEach(idx => STATE.players[srcOwnerId].bajadas[srcGrupoIndex].splice(idx, 1));
        }

        // Limpiar grupos vacíos si se consumieron por completo
        for (let keyId in STATE.players) {
            STATE.players[keyId].bajadas = STATE.players[keyId].bajadas.filter(g => g.length > 0);
        }

        // NOTA IMPORTANTE: Al filtrar los grupos vacíos, el índice del `targetGrupo` principal podría haber cambiado 
        // si consumimos por completo un grupo anterior del mismo ownerId.
        // Dado que hemos editado `bajadas`, lo más seguro es buscar el nuevo targetGrupo o simplemente haberlo mutado en lugar
        // Sin embargo, en JavaScript, los Arrays y variables guardan referencias. Si hacemos STATE.players[ownerId].bajadas = filtered
        // necesitamos re-asignar el combined al array final.
        // Por simplicidad en este caso, encontraremos el grupo de destino de nuevo buscando una intersección o asumiendo el index si no hubo borrado de índices inferiores:
        // Puesto que evitamos borrar desde el target en la regla `destiniesTableSelection`, solo podría cambiar el index de destino si borramos enteros los grupos *anteriores* al destino en la misma matriz.
        // Vamos a reescribirlo usando una actualización in-place con .splice() y push() para no romper referencias de array principal:

        targetGrupo.length = 0;
        combined.forEach(c => targetGrupo.push(c)); // Atualización in-place segura

        for (let keyId in STATE.players) {
            STATE.players[keyId].bajadas = STATE.players[keyId].bajadas.filter(g => g.length > 0);
        } // Refresh a empty groups, doesn't affect targetGrupo (now has combined.length > 0)


        // 2. Remover de mano humana
        indicesHand.forEach(idx => STATE.players[getMyId()].cards.splice(idx, 1));
        if (drawnIncluded) {
            STATE.drawnCardRef = null;
            STATE.hasDrawn = false;
            STATE.mustUseDiscard = false;
        }

        STATE.selectedCardsIndices = [];
        STATE.selectedTableCards = [];

        window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
        if (verificarVictoriaAuto(getMyId())) return;

        if (ownerId !== getMyId()) {
            // El jugador aggre garron la carta al grupo de un BOT.
            // El bot dueño del grupo debe descartar una carta automáticamente para mantener el equilibrio.
            renderMesa();
            const botPlayer = STATE.players[ownerId];
            const initiatorIndex = STATE.currentTurnIndex; // el humano inició la extensión
            setTimeout(() => {
                if (DOM.turnText) DOM.turnText.innerText = `${botPlayer.name} descarta por equilibrio...`; else DOM.turnIndicator.innerText = `${botPlayer.name} descarta por equilibrio...`;
                setTimeout(() => {
                    if (botPlayer.cards.length > 0) {
                        const dropIdx = Math.floor(Math.random() * botPlayer.cards.length);
                        const droppedCard = botPlayer.cards.splice(dropIdx, 1)[0];
                        STATE.hasDrawn = false;
                        STATE.mustUseDiscard = false;
                        STATE.selectedCardsIndices = [];
                        // Marcar regreso al humano (iniciador) no al siguiente en el reloj
                        STATE.pendingReturnToIndex = initiatorIndex;
                        iniciarCircuitoDescarte(droppedCard, STATE.turnOrder.indexOf(ownerId));
                    } else {
                        STATE.hasDrawn = false;
                        STATE.pendingReturnToIndex = initiatorIndex;
                        siguienteTurno();
                    }
                }, 1000);
            }, 400);
        } else {
            // El jugador agregó al su propio grupo — debe descartar una carta de su mano normalmente
            actualizarBotonesJuego();
            if (DOM.turnText) DOM.turnText.innerText = 'Carta(s) agregada(s). Selecciona una carta para botar y terminar el turno.'; else DOM.turnIndicator.innerText = 'Carta(s) agregada(s). Selecciona una carta para botar y terminar el turno.';
            DOM.btnPasar.innerText = 'Botar Carta';
            DOM.btnPasar.classList.remove('hidden');
            renderMesa();
        }
        syncStateToNetwork();
    } else {
        window.Telegram.WebApp.showAlert("Esta combinación no es válida para agregarse a ese Moche.");
        STATE.selectedCardsIndices = [];
        STATE.selectedTableCards = [];
        actualizarBotonesJuego();
        renderMesa();
    }
}

// =========================================
// FASE 2: JUEGO NORMAL
// =========================================
let turnTimerInterval = null;

function startTurnTimer(durationSecs) {
    stopTurnTimer();
    DOM.turnTimer.classList.remove('hidden');
    DOM.turnTimerBar.style.width = '100%';
    DOM.turnTimerBar.className = 'turn-timer-bar';

    void DOM.turnTimerBar.offsetWidth; // Force reflow
    DOM.turnTimerBar.style.transition = `width ${durationSecs}s linear`;
    DOM.turnTimerBar.style.width = '0%';

    let remaining = durationSecs;
    turnTimerInterval = setInterval(() => {
        remaining--;
        if (remaining <= 10 && remaining > 3) DOM.turnTimerBar.classList.add('warning');
        else if (remaining <= 3) DOM.turnTimerBar.classList.add('danger');

        if (remaining <= 0) {
            stopTurnTimer();
            handleTurnTimeout();
        }
    }, 1000);
}

function stopTurnTimer() {
    if (turnTimerInterval) clearInterval(turnTimerInterval);
    turnTimerInterval = null;
    if (DOM.turnTimer) DOM.turnTimer.classList.add('hidden');
    if (DOM.turnTimerBar) {
        DOM.turnTimerBar.style.transition = 'none';
        DOM.turnTimerBar.style.width = '100%';
    }
}

function handleTurnTimeout() {
    const isHumanTurn = STATE.phase === 'JUEGO' && STATE.turnOrder[STATE.currentTurnIndex] === getMyId();
    if (!isHumanTurn) return;

    if (!STATE.hasDrawn) {
        if (STATE.deck.length > 0) {
            STATE.drawnCardRef = STATE.deck.pop();
            STATE.hasDrawn = true;
            STATE.latestDiscardEnlarged = false;
        }
    }

    let discardedCard = null;
    if (STATE.drawnCardRef) {
        discardedCard = STATE.drawnCardRef;
        STATE.drawnCardRef = null;
    } else if (STATE.players[getMyId()].cards.length > 0) {
        discardedCard = STATE.players[getMyId()].cards.splice(0, 1)[0];
    }

    DOM.btnPasar.classList.add('hidden');
    STATE.selectedCardsIndices = [];
    STATE.hasDrawn = false;
    STATE.mustUseDiscard = false;
    iniciarCircuitoDescarte(discardedCard, STATE.currentTurnIndex);
    syncStateToNetwork();
}

function procesarTurno() {
    const currentPlayer = STATE.turnOrder[STATE.currentTurnIndex];
    renderMesa();

    if (STATE.deck.length === 0) {
        stopTurnTimer();
        manejarMazoAgotado();
        return;
    }

    stopTurnTimer();

    if (currentPlayer === getMyId()) {
        if (DOM.turnText) DOM.turnText.innerText = "¡Es tu turno! Roba del Mazo o del Descarte."; else DOM.turnIndicator.innerText = "¡Es tu turno! Roba del Mazo o del Descarte.";
        DOM.turnIndicator.style.borderColor = "#00ff00";
        actualizarBotonesJuego();
        startTurnTimer(30); // Ocultará Pasar al inicio
    } else {
        DOM.btnPasar.classList.add('hidden');
        const player = STATE.players[currentPlayer];
        if (DOM.turnText) DOM.turnText.innerText = `Turno de ${player ? player.name : '???'}...`; else DOM.turnIndicator.innerText = `Turno de ${player ? player.name : '???'}...`;
        DOM.turnIndicator.style.borderColor = "#ff4444";

        const isBot = player && player.is_bot;
        // In single-player mode, this client always acts as host for bots.
        // In multiplayer, only the room host drives bot turns.
        const isHost = !isMultiplayer || (window.CURRENT_ROOM_DATA && window.CURRENT_ROOM_DATA.host === window.USER_DATA.telegram_id.toString());

        if (isBot && isHost) {
            // Use a short delay so the UI message renders before the bot acts
            setTimeout(jugarTurnoBot, 1200);
        }
    }
}

// ==== ROBAR CARTAS HUMANO =====
function robarDelMazo() {
    if (STATE.phase !== 'JUEGO' || STATE.turnOrder[STATE.currentTurnIndex] !== getMyId() || STATE.hasDrawn) return;

    STATE.drawnCardRef = STATE.deck.pop();
    STATE.hasDrawn = true;
    STATE.latestDiscardEnlarged = false;
    STATE.drawnCardAnim = 'card-drawing';

    if (DOM.turnText) DOM.turnText.innerText = "Carta Robada. ¿Qué deseas hacer con ella u otra de tu mano?"; else DOM.turnIndicator.innerText = "Carta Robada. ¿Qué deseas hacer con ella u otra de tu mano?";
    actualizarBotonesJuego();
    window.Telegram.WebApp.HapticFeedback.impactOccurred('light');
    renderMesa();
    syncStateToNetwork();
}

function robarDelDescarte() {
    if (STATE.phase !== 'JUEGO' || STATE.turnOrder[STATE.currentTurnIndex] !== getMyId() || STATE.hasDrawn || STATE.discardPile.length === 0) return;

    STATE.drawnCardRef = STATE.discardPile.pop();
    STATE.hasDrawn = true;
    STATE.mustUseDiscard = true;
    STATE.latestDiscardEnlarged = false;
    STATE.drawnCardAnim = 'card-from-discard';

    if (DOM.turnText) DOM.turnText.innerText = "¡Tomaste el Descarte! Ahora selecciona cartas para armar un grupo o botar otra."; else DOM.turnIndicator.innerText = "¡Tomaste el Descarte! Ahora selecciona cartas para armar un grupo o botar otra.";
    actualizarBotonesJuego();
    window.Telegram.WebApp.HapticFeedback.impactOccurred('medium');
    renderMesa();
    syncStateToNetwork();
}

// ==========================================
// PASAR TURNO (HUMANO)
// ==========================================
function pasarTurnoHumano() {
    // Durante INTERCEPT_DISCARD: el humano descarta una carta para mantener equilibrio
    if (STATE.phase === 'INTERCEPT_DISCARD') {
        let discardedCard = null;

        if (STATE.selectedCardsIndices.length === 1 && STATE.selectedCardsIndices[0] !== "drawn") {
            const dropIndex = STATE.selectedCardsIndices[0];
            discardedCard = STATE.players[getMyId()].cards.splice(dropIndex, 1)[0];
            if (STATE.drawnCardRef) {
                STATE.players[getMyId()].cards.push(STATE.drawnCardRef);
                STATE.drawnCardRef = null;
            }
        } else if (STATE.selectedCardsIndices.length === 0 || STATE.selectedCardsIndices[0] === "drawn") {
            if (STATE.drawnCardRef) {
                discardedCard = STATE.drawnCardRef;
                STATE.drawnCardRef = null;
            } else {
                window.Telegram.WebApp.showAlert("Debes seleccionar una carta para botar.");
                return;
            }
        } else {
            return; // invalid count selected
        }

        STATE.interceptState = null;
        STATE.selectedCardsIndices = [];
        STATE.hasDrawn = false;
        STATE.mustUseDiscard = false;
        DOM.btnPasar.classList.add('hidden');
        STATE.phase = 'JUEGO';
        const humanIndex = STATE.turnOrder.indexOf(getMyId());
        iniciarCircuitoDescarte(discardedCard, humanIndex);
        return;
    }

    // Durante INTERCEPT: el humano declina la carta del descarte
    if (STATE.phase === 'INTERCEPT') {
        pasarInterceptHumano();
        return;
    }

    if (STATE.phase !== 'JUEGO' || STATE.turnOrder[STATE.currentTurnIndex] !== getMyId() || !STATE.hasDrawn) return;

    let discardedCard = null;

    if (STATE.selectedCardsIndices.length === 1 && STATE.selectedCardsIndices[0] !== "drawn") {
        const dropIndex = STATE.selectedCardsIndices[0];
        discardedCard = STATE.players[getMyId()].cards.splice(dropIndex, 1)[0];
        if (STATE.drawnCardRef) {
            STATE.players[getMyId()].cards.splice(dropIndex, 0, STATE.drawnCardRef);
            STATE.drawnCardRef = null;
        }
    } else if (STATE.selectedCardsIndices.length === 0 || STATE.selectedCardsIndices[0] === "drawn") {
        if (STATE.drawnCardRef) {
            discardedCard = STATE.drawnCardRef;
            STATE.drawnCardRef = null;
        } else {
            window.Telegram.WebApp.showAlert("Debes seleccionar una carta para botar y terminar tu turno.");
            return;
        }
    } else {
        return;
    }

    DOM.btnPasar.classList.add('hidden');
    STATE.selectedCardsIndices = [];
    DOM.btnBajar.classList.add('hidden');
    window.Telegram.WebApp.HapticFeedback.impactOccurred('light');

    iniciarCircuitoDescarte(discardedCard, STATE.currentTurnIndex);
    syncStateToNetwork();
}

// ==========================================
// INTERCEPT: El humano toma la carta del descarte
// ==========================================
function humanoTomaDescarteIntercept() {
    if (STATE.phase !== 'INTERCEPT' || !STATE.interceptState) return;

    const card = STATE.discardPile.pop();

    // Cambiado: En lugar de ir directo a la mano, se queda como carta robada
    STATE.drawnCardRef = card;
    STATE.hasDrawn = true;
    STATE.mustUseDiscard = true;

    DOM.btnTomar.classList.add('hidden');
    DOM.btnPasar.classList.add('hidden');

    STATE.interceptState.awaitingHumanDiscard = true;
    if (DOM.turnText) DOM.turnText.innerText = '¡Tomaste la carta del descarte! Selecciona cartas de tu mano para armar un grupo o bota otra.'; else DOM.turnIndicator.innerText = '¡Tomaste la carta del descarte! Selecciona cartas de tu mano para armar un grupo o bota otra.';
    DOM.btnPasar.innerText = 'Botar Carta';
    STATE.selectedCardsIndices = [];
    actualizarBotonesJuego();
    STATE.phase = 'INTERCEPT_DISCARD';
    renderMesa();
}

// El humano PASA durante el circuito
function pasarInterceptHumano() {
    if (STATE.phase !== 'INTERCEPT' || !STATE.interceptState) return;
    DOM.btnTomar.classList.add('hidden');
    DOM.btnPasar.classList.add('hidden');
    STATE.interceptState.offeredTo = (STATE.interceptState.offeredTo + 1) % 4;
    procesarCircuito();
}

// ==========================================
// BOT AI — Motor Estratégico Avanzado
// ==========================================

/**
 * Dado un array de cartas, encuentra todos los grupos válidos posibles (sin importar si son continuos)
 * Devuelve array de { cards: [...], indices: [...] }
 */
function botEncontrarGruposValidos(cards) {
    const grupos = [];
    const len = cards.length;
    // Probar todos los subsets de 3 y 4 cartas
    function combo(start, current, indices) {
        if (current.length === 3 || current.length === 4) {
            if (esMocheValido(current)) {
                grupos.push({ cards: [...current], indices: [...indices] });
            }
            if (current.length === 4) return;
        }
        for (let i = start; i < len; i++) {
            current.push(cards[i]);
            indices.push(i);
            combo(i + 1, current, indices);
            current.pop();
            indices.pop();
        }
    }
    combo(0, [], []);
    return grupos;
}

/**
 * Evalúa qué tan valiosa es una carta para la mano del bot.
 * Devuelve un score de "peligrosidad" — cuánto aporta esta carta a grupos potenciales.
 * Alta puntuación = carta valiosa (NO descartar). Baja puntuación = candidata a descarte.
 */
function botEvaluarValorCarta(card, hand) {
    let score = 0;
    const others = hand.filter(c => c !== card);

    // Buscar pares con la misma rank
    const sameRank = others.filter(c => c.rank === card.rank);
    score += sameRank.length * 3; // par = +3, trío existente = +6

    // Buscar cartas del mismo palo que sean adyacentes en valor
    const sameSuit = others.filter(c => c.suit === card.suit);
    sameSuit.forEach(c => {
        const diff = Math.abs(c.value - card.value);
        if (diff === 1) score += 2;      // contiguo
        else if (diff === 2) score += 1; // un salto
    });

    return score;
}

/**
 * Retorna true si la carta del descarte completa o avanza un meld en la mano del bot.
 * umbral: cuántos puntos mínimos debe tener para que valga tomarla.
 */
function botValeTomarDescarte(discardCard, hand, umbral = 2) {
    const testHand = [...hand, discardCard];
    const gruposConDescarte = botEncontrarGruposValidos(testHand);
    const gruposSinDescarte = botEncontrarGruposValidos(hand);

    if (gruposConDescarte.length > gruposSinDescarte.length) return true; // completa un meld
    return botEvaluarValorCarta(discardCard, hand) >= umbral;
}

/**
 * Verifica si el bot puede extender algún grupo ya bajado en la mesa.
 * Retorna { ownerId, grupoIndex, card } o null.
 */
function botBuscarExtensionMesa(card) {
    for (const pid in STATE.players) {
        // Protección: no extender grupos de quien solo tiene 1 carta (está a punto de ganar)
        if (STATE.players[pid].cards.length <= 1) continue;

        const bajadas = STATE.players[pid].bajadas;
        for (let gi = 0; gi < bajadas.length; gi++) {
            const combined = [...bajadas[gi], card];
            if (combined.length <= 4 && esMocheValido(combined)) {
                return { ownerId: pid, grupoIndex: gi };
            }
        }
    }
    return null;
}

/**
 * Motor principal del turno de un bot.
 */
function jugarTurnoBot() {
    const pid = STATE.turnOrder[STATE.currentTurnIndex];
    const player = STATE.players[pid];
    const difficultyKey = STATE.difficulty || 'easy';

    // ─── FASE 1: DECIDIR QUÉ ROBAR ────────────────────────────────────────
    const topDiscard = STATE.discardPile.length > 0 ? STATE.discardPile[STATE.discardPile.length - 1] : null;
    const handCount = player.cards.length;

    // Perfiles de IA basados en Dificultad
    const aiProfiles = {
        easy: { baseAggressiveness: 0.30, discardThreshold: 3 }, // Pasivo, solo toma descartes obvios
        medium: { baseAggressiveness: 0.50, discardThreshold: 2 }, // Intermedio, calcula si ayuda
        hard: { baseAggressiveness: 0.75, discardThreshold: 1 }, // Agresivo, farolea (baja rápido) y roba más descarte
        pro: { baseAggressiveness: 0.95, discardThreshold: 1 }  // Profesional, cuenta cartas casi perfectas y bloquea humano
    };

    const profile = aiProfiles[difficultyKey];
    const handBonus = handCount <= 5 ? 0.15 : handCount <= 8 ? 0.05 : 0;
    const aggressiveness = Math.min(0.99, profile.baseAggressiveness + handBonus);

    let drawnCard = null;
    let drewFromDiscard = false;

    // Cálculo Inteligente de Descarte
    if (topDiscard && botValeTomarDescarte(topDiscard, player.cards, profile.discardThreshold)) {
        drawnCard = STATE.discardPile.pop();
        drewFromDiscard = true;
        STATE.latestDiscardEnlarged = false;

        // Efecto visual premium/sonido en bots pro/hard
        if ((difficultyKey === 'pro' || difficultyKey === 'hard') && window.CasinoAudio) {
            window.CasinoAudio.playSfx('chip_toss');
        }
    } else {
        if (STATE.deck.length === 0) { manejarMazoAgotado(); return; }
        drawnCard = STATE.deck.pop();
        STATE.latestDiscardEnlarged = false;
    }

    player.cards.push(drawnCard);

    // ─── FASE 2: INTENTAR EXTENDER GRUPOS EN MESA ─────────────────────────
    const extension = botBuscarExtensionMesa(drawnCard);
    if (extension) {
        const targetGroup = STATE.players[extension.ownerId].bajadas[extension.grupoIndex];
        targetGroup.push(drawnCard);
        player.cards.splice(player.cards.indexOf(drawnCard), 1);

        // El iniciador (este bot) debe recuperar el turno después del descarte del dueño
        const initiatorIndex = STATE.currentTurnIndex;

        if (extension.ownerId === getMyId()) {
            // El bot extendió el grupo del humano — el humano elige qué descartar
            renderMesa();
            STATE.pendingReturnToIndex = initiatorIndex;
            STATE.hasDrawn = false;
            if (DOM.turnText) DOM.turnText.innerText = `${player.name} agregó una carta a tu grupo. Debes descartar una carta obligatoriamente.`; else DOM.turnIndicator.innerText = `${player.name} agregó una carta a tu grupo. Debes descartar una carta obligatoriamente.`;
            DOM.turnIndicator.style.borderColor = '#ff9900';
            DOM.btnPasar.innerText = 'Botar Carta';
            DOM.btnPasar.classList.remove('hidden');
            DOM.btnBajar.classList.add('hidden');
            STATE.phase = 'JUEGO';
            STATE.currentTurnIndex = STATE.turnOrder.indexOf(getMyId());
            actualizarBotonesJuego();
            return;
        } else if (extension.ownerId !== pid) {
            // Bot extendió el grupo de otro bot — ese bot descarta automáticamente
            const ownerPlayer = STATE.players[extension.ownerId];
            if (ownerPlayer.cards.length > 0) {
                const sacrifice = botElegirDescarte(ownerPlayer.cards);
                ownerPlayer.cards.splice(ownerPlayer.cards.indexOf(sacrifice), 1);
                STATE.latestDiscardEnlarged = true;
                STATE.pendingReturnToIndex = initiatorIndex;
                setTimeout(() => iniciarCircuitoDescarte(sacrifice, STATE.turnOrder.indexOf(extension.ownerId)), 500);
            } else {
                STATE.pendingReturnToIndex = initiatorIndex;
                siguienteTurno();
            }
            return;
        }
        // Si extendió su propio grupo, continúa normalmente (no hay return aquí)
    }

    // ─── FASE 3: BUSCAR Y BAJAR GRUPOS VÁLIDOS ────────────────────────────
    let bajosAlgunoGrupo = true;
    while (bajosAlgunoGrupo) {
        bajosAlgunoGrupo = false;
        const grupos = botEncontrarGruposValidos(player.cards);
        if (grupos.length > 0) {
            // Preferir grupos de 4, luego de 3
            const best = grupos.sort((a, b) => b.cards.length - a.cards.length)[0];

            // Lógica Avanzada de Bluff/Hold (Pro/Hard)
            // Bots en Pro a veces retienen grupos perfectos en mano para bajarlos de golpe y sorprender
            let shouldLower = true;
            if (difficultyKey === 'pro' && best.cards.length === 3 && handCount > 6) {
                // Pro tiene 30% de probabilidad de esconder un grupo de 3 si tiene muchas cartas
                shouldLower = Math.random() > 0.30;
            } else if (difficultyKey === 'easy') {
                // Easy tiene 20% de prob de "olvidar" bajar el grupo esta ronda por ser novato
                shouldLower = Math.random() > 0.20;
            }

            if (shouldLower) {
                const sortedIndices = [...best.indices].sort((a, b) => b - a);
                sortedIndices.forEach(idx => player.cards.splice(idx, 1));
                player.bajadas.push(best.cards);
                bajosAlgunoGrupo = true; // Re-evaluar con la mano reducida
                if (verificarVictoriaAuto(pid)) return;
            }
        }
    }

    // ─── FASE 4: EXTENDER GRUPOS PROPIOS CON CARTAS DE LA MANO ───────────
    // Intentar agregar cartas sueltas a grupos propios para quedar con menos cartas
    let extendido = true;
    while (extendido) {
        extendido = false;
        for (let gi = 0; gi < player.bajadas.length; gi++) {
            for (let ci = 0; ci < player.cards.length; ci++) {
                const card = player.cards[ci];
                const combined = [...player.bajadas[gi], card];
                if (combined.length <= 4 && esMocheValido(combined)) {
                    player.bajadas[gi].push(card);
                    player.cards.splice(ci, 1);
                    extendido = true;
                    if (verificarVictoriaAuto(pid)) return;
                    break;
                }
            }
            if (extendido) break;
        }
    }

    // ─── FASE 5: ELEGIR QUÉ DESCARTAR ─────────────────────────────────────
    if (player.cards.length === 0) {
        // Bot ganó al bajar todo — victoriaAuto ya lo maneja
        return;
    }

    const cardToDiscard = botElegirDescarte(player.cards);
    player.cards.splice(player.cards.indexOf(cardToDiscard), 1);
    STATE.latestDiscardEnlarged = true;
    iniciarCircuitoDescarte(cardToDiscard, STATE.currentTurnIndex);
}

/**
 * Elige la carta menos valiosa de la mano para descartar.
 * Evita descartar cartas que el jugador humano podría usar.
 */
function botElegirDescarte(cards) {
    if (cards.length === 0) return null;

    const difficultyKey = STATE.difficulty || 'easy';

    // Calcular puntaje de retención para cada carta
    const scores = cards.map(card => {
        let retention = botEvaluarValorCarta(card, cards);
        let danger = 0;

        // Card Counting defensivo solo en Hard y Pro
        if (difficultyKey === 'hard' || difficultyKey === 'pro') {
            const humanDanger = botCartaPeligrosaParaHumano(card);

            if (humanDanger) {
                // Pro nunca le dará una carta nivel 3+ al humano a menos que no tenga otra opción
                danger = difficultyKey === 'pro' ? 99 : 2;
            }
        }

        return {
            card,
            totalScore: retention + danger
        };
    });

    // Ordenar: descartar la de menor impacto (retention + danger)
    scores.sort((a, b) => a.totalScore - b.totalScore);

    return scores[0].card;
}

/**
 * Heurística rápida: ¿esta carta podría beneficiar directamente al humano?
 * Si la suma de retention con la mano humana es alta, es peligrosa.
 */
function botCartaPeligrosaParaHumano(card) {
    const humanHand = STATE.players[getMyId()].cards;
    return botEvaluarValorCarta(card, humanHand) >= 3;
}

function siguienteTurno() {
    // Si hay un regreso pendiente al iniciador de una extensión de grupo, lo usamos
    const n = STATE.turnOrder.length;
    if (STATE.pendingReturnToIndex !== null) {
        STATE.currentTurnIndex = STATE.pendingReturnToIndex % n;
        STATE.pendingReturnToIndex = null;
    } else {
        STATE.currentTurnIndex = (STATE.currentTurnIndex + 1) % n;
    }
    STATE.hasDrawn = false;
    STATE.drawnCardRef = null;
    STATE.mustUseDiscard = false;
    STATE.interceptState = null;
    DOM.discardPile.classList.remove('selected');
    if (DOM.btnTomar) DOM.btnTomar.classList.add('hidden');
    syncStateToNetwork();
    procesarTurno();
}

// ==========================================
// CIRCUITO DE DESCARTE (intercept)
// ==========================================
function iniciarCircuitoDescarte(card, discardedByIndex) {
    STATE.discardPile.push(card);
    STATE.latestDiscardEnlarged = true; // Resaltar la carta recién descartada
    renderMesa();

    const firstCandidate = (discardedByIndex + 1) % 4;

    STATE.interceptState = {
        discardedByIndex,
        offeredTo: firstCandidate,
        awaitingHumanDiscard: false
    };

    STATE.phase = 'INTERCEPT';
    procesarCircuito();
}

function procesarCircuito() {
    const ix = STATE.interceptState;
    if (!ix) { siguienteTurno(); return; } // safety guard

    const n = STATE.turnOrder.length;

    // Safety: circuit completion — we have gone around the whole table
    // offeredTo wraps back to the discardedBy index → nobody wanted it → move on
    if (ix.offeredTo % n === ix.discardedByIndex % n) {
        STATE.phase = 'JUEGO';
        STATE.interceptState = null;
        siguienteTurno();
        return;
    }

    // Clamp offeredTo to valid turn-order index
    const turnIdx = ix.offeredTo % n;
    const candidate = STATE.turnOrder[turnIdx];

    if (!candidate || !STATE.players[candidate]) {
        // No such player — skip silently
        ix.offeredTo = (ix.offeredTo + 1) % n;
        procesarCircuito();
        return;
    }

    if (candidate === getMyId()) {
        if (DOM.turnText) DOM.turnText.innerText = `¡Carta disponible en el descarte! ¿Deseas tomarla?`; else DOM.turnIndicator.innerText = `¡Carta disponible en el descarte! ¿Deseas tomarla?`;
        DOM.turnIndicator.style.borderColor = '#ffd700';
        DOM.btnTomar.classList.remove('hidden');
        DOM.btnPasar.innerText = 'Dejar Pasar';
        DOM.btnPasar.classList.remove('hidden');
        DOM.btnBajar.classList.add('hidden');
    } else {
        if (DOM.turnText) DOM.turnText.innerText = `${STATE.players[candidate].name} considera el descarte...`; else DOM.turnIndicator.innerText = `${STATE.players[candidate].name} considera el descarte...`;
        DOM.turnIndicator.style.borderColor = '#ff4444';
        renderMesa();

        const isBot = STATE.players[candidate] && STATE.players[candidate].is_bot;
        const isHost = !isMultiplayer || (window.CURRENT_ROOM_DATA && window.CURRENT_ROOM_DATA.host === window.USER_DATA.telegram_id.toString());

        if (isBot && isHost) {
            setTimeout(() => { botDecideIntercept(candidate); }, 1000);
        } else if (!isBot) {
            // Non-human non-bot remote player: skip automatically with a small delay
            setTimeout(() => {
                ix.offeredTo = (ix.offeredTo + 1) % n;
                procesarCircuito();
            }, 600);
        }
    }
}

function botDecideIntercept(botId) {
    // Safety: if state changed while timer was pending, abort
    if (STATE.phase !== 'INTERCEPT' || !STATE.interceptState) return;

    const card = STATE.discardPile[STATE.discardPile.length - 1];
    if (!card) {
        // Discard pile is empty somehow — skip
        STATE.interceptState.offeredTo = (STATE.interceptState.offeredTo + 1) % STATE.turnOrder.length;
        procesarCircuito();
        return;
    }

    const botCards = STATE.players[botId] ? STATE.players[botId].cards : [];
    const n = STATE.turnOrder.length;
    let useful = false;

    // Check if the discard card completes a valid group with any 2 cards in hand
    for (let i = 0; i < botCards.length && !useful; i++) {
        for (let j = i + 1; j < botCards.length && !useful; j++) {
            if (esMocheValido([card, botCards[i], botCards[j]])) useful = true;
        }
    }

    if (useful && Math.random() > 0.3) {
        STATE.discardPile.pop();
        botCards.push(card);
        // Bot discards its weakest card in exchange
        const dropIdx = Math.floor(Math.random() * botCards.length);
        const dropped = botCards.splice(dropIdx, 1)[0];
        iniciarCircuitoDescarte(dropped, STATE.turnOrder.indexOf(botId));
    } else {
        // ALWAYS advance — this is the mandatory escape path
        STATE.interceptState.offeredTo = (STATE.interceptState.offeredTo + 1) % n;
        procesarCircuito();
    }
}

// ==========================================
// VICTORIA AUTOMÁTICA
// ==========================================

// ==========================================
// VALIDADOR DE MOCHE (Backtracking)
// ==========================================
function agruparCartas(cards) {
    if (cards.length === 0) return true;

    let sorted = [...cards].sort((a, b) => a.value - b.value);
    let c1 = sorted[0];

    // Intento 1: Tercia
    let sameRank = sorted.filter(c => c.rank === c1.rank);
    if (sameRank.length >= 3) {
        let nextRest = [...sorted];
        nextRest.splice(nextRest.indexOf(sameRank[0]), 1);
        nextRest.splice(nextRest.indexOf(sameRank[1]), 1);
        nextRest.splice(nextRest.indexOf(sameRank[2]), 1);
        if (agruparCartas(nextRest)) return true;

        if (sameRank.length === 4) {
            let nextRest4 = [...sorted];
            nextRest4.splice(nextRest4.indexOf(sameRank[0]), 1);
            nextRest4.splice(nextRest4.indexOf(sameRank[1]), 1);
            nextRest4.splice(nextRest4.indexOf(sameRank[2]), 1);
            nextRest4.splice(nextRest4.indexOf(sameRank[3]), 1);
            if (agruparCartas(nextRest4)) return true;
        }
    }

    // Intento 2: Corrida
    let suitCards = sorted.filter(c => c.suit === c1.suit);
    let sequence = [c1];
    let expectedValue = c1.value + 1;
    for (let i = 1; i < suitCards.length; i++) {
        if (suitCards[i].value === expectedValue) {
            sequence.push(suitCards[i]);
            expectedValue++;
        }
    }

    if (sequence.length >= 3) {
        let nextRest = [...sorted];
        nextRest.splice(nextRest.indexOf(sequence[0]), 1);
        nextRest.splice(nextRest.indexOf(sequence[1]), 1);
        nextRest.splice(nextRest.indexOf(sequence[2]), 1);
        if (agruparCartas(nextRest)) return true;

        if (sequence.length >= 4) {
            let nextRest4 = [...nextRest];
            nextRest4.splice(nextRest4.indexOf(sequence[3]), 1);
            if (agruparCartas(nextRest4)) return true;
        }
    }

    return false;
}

function validarMocheTotal(cards) {
    if (cards.length !== 10) return false;
    for (let i = 0; i < 10; i++) {
        const remaining = [...cards];
        remaining.splice(i, 1);
        if (agruparCartas(remaining)) return true;
    }
    return false;
}

// ==========================================
// PARTIDA: GANAR / MAZO AGOTADO
// ==========================================
function ganarPartida() {
    STATE.phase = 'FIN';
    const premio = STATE.apuestaActual * 4;

    fetch('/win', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cantidad: premio, source: 'moche', multiplier: 4 })
    })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'ok') {
                if (data.profile_updates && window.UserProfileManager) window.UserProfileManager.checkLevelUp(data.profile_updates);
                updateBitsUI(data.bits);
                const winnerUIZone = STATE.turnOrder[STATE.currentTurnIndex] === getMyId() ? 'human' : getZoneByPlayerId(STATE.turnOrder[STATE.currentTurnIndex]);
                animarPremioAlGanador(premio, winnerUIZone);
                document.getElementById('betting-controls')?.classList.add('hidden');

                if (window.CasinoAudio) {
                    if (premio > 1000) window.CasinoAudio.playSfx('win_big');
                    else window.CasinoAudio.playSfx('win_normal');
                }

                setTimeout(() => {
                    mostrarAlerta('¡VICTORIA!', `¡Bajaste todas tus cartas a la mesa!\nGanaste +${premio} Bits.`, 'Volver a Jugar');
                }, 1500); // Dar tiempo a la animacion
            }
        });
}

function manejarMazoAgotado() {
    STATE.phase = 'FIN';
    const apuestaAnterior = STATE.apuestaActual;
    const apuestaDoble = apuestaAnterior * 2;

    const bitsActuales = window.USER_DATA ? window.USER_DATA.bits : 0;

    if (bitsActuales < apuestaDoble) {
        // El jugador no puede cubrir la nueva apuesta — queda eliminado
        // Los bits de la apuesta anterior ya fueron descontados al inicio de la partida.
        mostrarAlerta(
            '❌ Eliminado',
            `Nadie logró cerrar el juego. La apuesta se duplica a ${apuestaDoble} Bits, pero solo tienes ${bitsActuales} Bits disponibles.\n\nPierdes los ${apuestaAnterior} Bits de la apuesta y quedas fuera de esta ronda.`,
            'Volver al Lobby'
        );
        // Botón regresa al lobby
        DOM.overlayBtn.onclick = () => { window.location.href = '/'; };
    } else {
        // El jugador sí puede cubrir la nueva apuesta — se duplica y se reinicia
        STATE.apuestaActual = apuestaDoble;
        mostrarAlerta(
            '🃏 Mazo Agotado — Doble Apuesta',
            `Nadie logró cerrar la ronda. La apuesta sube a ${apuestaDoble} Bits.\n\n¿Deseas continuar y apostar el doble?`,
            `✅ Continuar (${apuestaDoble} Bits)`
        );
        // Reiniciar correctamente descontando la nueva apuesta
        DOM.overlayBtn.onclick = () => {
            DOM.overlay.classList.add('hidden');
            DOM.overlayBtn.onclick = null; // Limpiar listener

            // Fichas extras (Double) del humano
            animarFichasAlCentro(apuestaAnterior, 'human');

            // y las de los bots
            const botsOnly = STATE.turnOrder.filter(pid => pid !== getMyId() && pid !== 'human');
            botsOnly.forEach((bid, idx) => {
                setTimeout(() => {
                    animarFichasAlCentro(apuestaAnterior, getZoneByPlayerId(bid));
                }, (idx + 1) * 200);
            });

            STATE.apuestaActual = STATE.apuestaActual + (apuestaAnterior * STATE.turnOrder.length);

            iniciarPartida();
        };
    }
}

// ==========================================
// SISTEMA DE FICHAS Y APUESTAS VISUALES
// ==========================================

function animarFichaHaciaMesa(btnEl, callback) {
    if (window.CasinoAudio) window.CasinoAudio.playSfx('chip_drop');

    // 1. Clonar el botón/imagen tocado
    const rect = btnEl.getBoundingClientRect();
    const clone = btnEl.cloneNode(true);

    // 2. Posicionarlo exactamente encima en fixed
    clone.style.position = 'fixed';
    clone.style.top = `${rect.top}px`;
    clone.style.left = `${rect.left}px`;
    clone.style.width = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    clone.style.margin = '0';
    clone.classList.remove('btn-bet', 'chip-img-btn'); // remove interactive classes
    clone.classList.add('flying-chip');

    document.body.appendChild(clone);

    // 3. Obtener el destino (el pozo central)
    const els = getElementsForChips();
    const targetRect = els.potChipsContainer.getBoundingClientRect();

    // Calcular centro del pozo con ligera aleatoriedad
    const offsetX = (Math.random() * 20) - 10;
    const offsetY = (Math.random() * 20) - 10;
    const targetX = targetRect.left + (targetRect.width / 2) - (rect.width / 2) + offsetX;
    const targetY = targetRect.top + (targetRect.height / 2) - (rect.height / 2) + offsetY;

    // Forzar reflow
    void clone.offsetWidth;

    // 4. Activar transición
    clone.style.transform = `translate(${targetX - rect.left}px, ${targetY - rect.top}px) scale(0.6)`;
    clone.style.opacity = '0.7';

    // 5. Limpiar y continuar
    setTimeout(() => {
        clone.remove();
        if (callback) callback();
    }, 500); // 500ms aligns with CSS flight duration
}

function getElementsForChips() {
    return {
        potTotal: document.getElementById('pot-amount'),
        potChipsContainer: document.getElementById('pot-chips'),
        chipsLayer: document.getElementById('chips-animation-layer'),
        bitsDisplay: document.getElementById('bits-display')
    };
}

function initBettingButtons() {
    const betButtons = document.querySelectorAll('.btn-bet');

    betButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (STATE.phase === 'JUEGO' || STATE.phase === 'INTERCEPT_DISCARD' || STATE.phase === 'FIN') {
                window.Telegram.WebApp.showAlert('El aumento de apuesta solo se puede realizar antes de comenzar la partida.');
                return;
            }

            if (STATE.pendingRaise) {
                window.Telegram.WebApp.showAlert('Ya hay un aumento de apuesta en progreso.');
                return;
            }

            const amount = parseInt(btn.dataset.amount);

            // Validar fondos
            if (window.USER_DATA.bits < amount) {
                window.Telegram.WebApp.showAlert('No tienes suficientes Bits para esta apuesta extra.');
                return;
            }

            // Disparar animación visual PRIMERO
            animarFichaHaciaMesa(btn, () => {
                // Al llegar la ficha a la mesa, dispara logica
                iniciarPropuestaAumento(getMyId(), amount);
                if (isMultiplayer && mocheChannel) {
                    mocheChannel.send({
                        type: 'broadcast',
                        event: 'moche_events',
                        payload: {
                            type: 'propose_raise',
                            payload: {
                                room_id: window.USER_DATA.room_id,
                                player_id: getMyId(),
                                amount: amount
                            }
                        }
                    });
                }
            });
        });
    });

    // Módulos UI del modal
    if (DOM.btnRaiseAccept) {
        DOM.btnRaiseAccept.addEventListener('click', () => {
            responderAumento(true);
        });
    }
    if (DOM.btnRaiseReject) {
        DOM.btnRaiseReject.addEventListener('click', () => {
            responderAumento(false);
        });
    }
}

// LÓGICA DE AUMENTO DE APUESTAS (IGUALACIÓN Y CANCELACIÓN)

function iniciarPropuestaAumento(proposerId, amount) {
    const requiredPlayers = STATE.turnOrder.filter(id => id !== proposerId);

    STATE.pendingRaise = {
        proposer: proposerId,
        amount: amount,
        responses: {},
        required: requiredPlayers
    };

    // Animar a pending
    const pZone = getZoneByPlayerId(proposerId);
    animarFichasAlCentro(amount, pZone, true);
    if (window.CasinoAudio) window.CasinoAudio.playSfx('chip_drop');

    if (getElementsForChips().potTotal) {
        getElementsForChips().potTotal.innerText = `+${amount} Pendiente`;
    }

    iniciarEvaluacionRaise();
}

function manejarPropuestaAumento(proposerId, amount) {
    if (STATE.pendingRaise) return; // Ya hay uno
    const requiredPlayers = STATE.turnOrder.filter(id => id !== proposerId);

    STATE.pendingRaise = {
        proposer: proposerId,
        amount: amount,
        responses: {},
        required: requiredPlayers
    };

    const pZone = getZoneByPlayerId(proposerId);
    animarFichasAlCentro(amount, pZone, true);
    if (window.CasinoAudio) window.CasinoAudio.playSfx('chip_drop');

    if (getElementsForChips().potTotal) {
        getElementsForChips().potTotal.innerText = `+${amount} Pendiente`;
    }

    iniciarEvaluacionRaise();
}

function iniciarEvaluacionRaise() {
    const pr = STATE.pendingRaise;
    if (!pr) return;

    // Si el humano debe responder
    if (pr.required.includes(getMyId()) || pr.required.includes('human')) {
        mostrarModalRaise(pr.proposer, pr.amount);
    }

    // Los bots deciden (El host maneja la IA de los bots)
    const isHost = !isMultiplayer || (window.CURRENT_ROOM_DATA && window.CURRENT_ROOM_DATA.host === window.USER_DATA.telegram_id.toString());
    if (isHost) {
        pr.required.forEach(pid => {
            const playerInfo = STATE.players[pid];
            if (playerInfo && playerInfo.is_bot) {
                setTimeout(() => {
                    botEvaluarAumento(pid, pr.amount);
                }, 1500 + Math.random() * 1500); // 1.5s - 3s delay
            }
        });
    }
}

function mostrarModalRaise(proposerId, amount) {
    if (!DOM.raiseModal) return;
    const proposerName = STATE.players[proposerId] ? STATE.players[proposerId].name : 'Un jugador';
    DOM.raiseMessage.innerHTML = `<strong>${proposerName}</strong> ha subido la apuesta en <strong id="raise-amount-text" style="color:#ffd700;">${amount}</strong> Bits.`;

    // Collective Confirmation UI
    const statusList = document.getElementById('raise-status-list');
    if (statusList && STATE.pendingRaise) {
        statusList.innerHTML = '';
        STATE.pendingRaise.required.forEach(pid => {
            const pName = STATE.players[pid] ? STATE.players[pid].name : 'Jugador';

            const li = document.createElement('li');
            li.id = `raise-status-${pid}`;
            li.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; background: rgba(255,255,255,0.05); border-radius: 4px;';

            const nameSpan = document.createElement('span');
            nameSpan.style.color = '#fff';
            nameSpan.textContent = pid === getMyId() ? 'Tú' : pName;

            const iconSpan = document.createElement('span');
            iconSpan.className = 'status-icon';
            iconSpan.style.fontSize = '1.2em';
            iconSpan.textContent = '⏳'; // Pending by default

            li.appendChild(nameSpan);
            li.appendChild(iconSpan);
            statusList.appendChild(li);
        });
    }

    // Check if human can afford it
    if (window.USER_DATA.bits < amount) {
        DOM.btnRaiseAccept.disabled = true;
        DOM.btnRaiseAccept.style.opacity = '0.5';
        DOM.btnRaiseAccept.innerText = 'Sin fondos';
    } else {
        DOM.btnRaiseAccept.disabled = false;
        DOM.btnRaiseAccept.style.opacity = '1';
        DOM.btnRaiseAccept.innerText = 'Igualar';
    }

    DOM.raiseModal.classList.remove('hidden');

    if (DOM.raiseTimerBar) {
        DOM.raiseTimerBar.style.transition = 'none';
        DOM.raiseTimerBar.style.width = '100%';
        setTimeout(() => {
            DOM.raiseTimerBar.style.transition = 'width 10s linear';
            DOM.raiseTimerBar.style.width = '0%';
        }, 50);
    }
}

function responderAumento(accepted) {
    if (DOM.raiseModal) DOM.raiseModal.classList.add('hidden');
    if (!STATE.pendingRaise) return;

    const myId = getMyId();
    if (isMultiplayer && mocheChannel) {
        mocheChannel.send({
            type: 'broadcast',
            event: 'moche_events',
            payload: {
                type: 'raise_response',
                payload: {
                    room_id: window.USER_DATA.room_id,
                    player_id: myId,
                    accepted: accepted
                }
            }
        });
    } else {
        procesarRespuestaRaise(myId, accepted);
    }
}

function botEvaluarAumento(botId, amount) {
    if (!STATE.pendingRaise) return;

    // Logica simplificada: depende de dificultad y suerte
    let acceptProb = 0.5;
    if (STATE.difficulty === 'hard' || STATE.difficulty === 'pro') acceptProb = 0.7;

    const accepted = Math.random() < acceptProb;
    if (isMultiplayer && mocheChannel) {
        mocheChannel.send({
            type: 'broadcast',
            event: 'moche_events',
            payload: {
                type: 'raise_response',
                payload: {
                    room_id: window.USER_DATA.room_id,
                    player_id: botId,
                    accepted: accepted
                }
            }
        });
    } else {
        procesarRespuestaRaise(botId, accepted);
    }
}

function procesarRespuestaRaise(playerId, accepted) {
    const pr = STATE.pendingRaise;
    if (!pr) return;

    pr.responses[playerId] = accepted;

    // Actualizar UI del usuario si el modal está abierto
    const statusLi = document.getElementById(`raise-status-${playerId}`);
    if (statusLi) {
        const iconSpan = statusLi.querySelector('.status-icon');
        if (iconSpan) {
            iconSpan.textContent = accepted ? '✅' : '❌';
            statusLi.style.background = accepted ? 'rgba(0, 200, 83, 0.2)' : 'rgba(255, 51, 51, 0.2)';
        }
    }

    // Solo el Host resuelve el resultado global
    const isHost = !isMultiplayer || (window.CURRENT_ROOM_DATA && window.CURRENT_ROOM_DATA.host === window.USER_DATA.telegram_id.toString());

    if (isHost) {
        // Regla: 100% Consenso. Si alguien rechaza, se cancela inmediatamente.
        if (accepted === false) {
            const resolveData = {
                room_id: window.USER_DATA ? window.USER_DATA.room_id : null,
                status: 'cancelled',
                amount: pr.amount,
                proposer: pr.proposer,
                acceptors: Object.keys(pr.responses).filter(pid => pr.responses[pid]),
                rejectorId: playerId
            };

            // Pequeño delay para que vean la cruz roja (❌) antes de que se cierre
            setTimeout(() => {
                if (isMultiplayer && mocheChannel) {
                    mocheChannel.send({
                        type: 'broadcast',
                        event: 'moche_events',
                        payload: { type: 'raise_resolved', payload: resolveData }
                    });
                } else {
                    resolverRaise('cancelled', pr.amount, pr.proposer, resolveData.acceptors, playerId);
                }
            }, 800);
            return;
        }

        // Si llegó aquí es porque este jugador aceptó. Verificamos si ya todos aceptaron.
        if (Object.keys(pr.responses).length === pr.required.length) {
            const allAccepted = Object.values(pr.responses).every(val => val === true);

            if (allAccepted) {
                const resolveData = {
                    room_id: window.USER_DATA ? window.USER_DATA.room_id : null,
                    status: 'accepted',
                    amount: pr.amount,
                    proposer: pr.proposer,
                    acceptors: Object.keys(pr.responses)
                };

                setTimeout(() => {
                    if (isMultiplayer && mocheChannel) {
                        mocheChannel.send({
                            type: 'broadcast',
                            event: 'moche_events',
                            payload: { type: 'raise_resolved', payload: resolveData }
                        });
                    } else {
                        resolverRaise('accepted', pr.amount, pr.proposer, resolveData.acceptors);
                    }
                }, 500);
            }
        }
    }
}

function resolverRaise(status, amount, proposerId, acceptors, rejectorId = null) {
    if (!STATE.pendingRaise) return;

    if (status === 'cancelled') {
        // ALGUIEN RECHAZÓ: Devolver fichas y cancelar
        if (getElementsForChips().potTotal) {
            getElementsForChips().potTotal.innerText = `Rechazado`;
        }

        animarFichasRetornar(amount, getZoneByPlayerId(proposerId));

        setTimeout(() => {
            actualizarPozoTotal(STATE.apuestaActual);
        }, 1200);

        // Mostrar notificación de quién lo rechazó y para todos
        const rejectorName = (rejectorId && STATE.players[rejectorId]) ? STATE.players[rejectorId].name : 'Un jugador';
        const msg = proposerId === getMyId()
            ? `Tu aumento fue rechazado por ${rejectorName}.`
            : `El aumento fue rechazado por ${rejectorName}.`;

        if (typeof mostrarAlertaToast === 'function') {
            mostrarAlertaToast(msg);
        } else if (window.Telegram?.WebApp) {
            window.Telegram.WebApp.showAlert(msg);
        }

    } else if (status === 'accepted') {
        // ALGUIEN ACEPTÓ

        // 1. Cobrar al que propuso (si soy yo)
        if (proposerId === getMyId() || proposerId === 'human') {
            efectuarCobroRealApuesta(amount);
        }

        // 2. Cobrar a los que aceptaron y animar sus fichas
        acceptors.forEach((pid, idx) => {
            if (pid === getMyId() || pid === 'human') {
                efectuarCobroRealApuesta(amount);
            }
            setTimeout(() => {
                animarFichasAlCentro(amount, getZoneByPlayerId(pid), false);
                if (window.CasinoAudio) window.CasinoAudio.playSfx('chip_drop');
            }, idx * 300);
        });

        // 3. Mover las fichas pendientes al pozo real
        const { potChipsContainer, pendingPotChipsContainer } = getElementsForChips();
        if (pendingPotChipsContainer && potChipsContainer) {
            Array.from(pendingPotChipsContainer.children).forEach(chip => {
                potChipsContainer.appendChild(chip);
            });
        }

        // 4. Sumar el total (proposer + todos los acceptors)
        const totalAumento = amount + (amount * acceptors.length);
        STATE.apuestaActual += totalAumento;

        setTimeout(() => {
            actualizarPozoTotal(STATE.apuestaActual);
        }, (acceptors.length * 300) + 500);
    }

    // Clean up state
    STATE.pendingRaise = null;
    if (DOM.raiseModal) DOM.raiseModal.classList.add('hidden');
}

function efectuarCobroRealApuesta(amount) {
    fetch('/bet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cantidad: amount, source: 'moche' })
    })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'ok') {
                if (data.profile_updates && window.UserProfileManager) window.UserProfileManager.checkLevelUp(data.profile_updates);
                updateBitsUI(data.bits);
            }
        })
        .catch(console.error);
}

function getElementsForChips() {
    return {
        potTotal: document.getElementById('pot-amount'),
        potChipsContainer: document.getElementById('pot-chips'),
        pendingPotChipsContainer: document.getElementById('pending-pot-chips'),
        chipsLayer: document.getElementById('chips-animation-layer'),
        bitsDisplay: document.getElementById('global-bits-display')
    };
}

function getZoneByPlayerId(playerId) {
    if (playerId === getMyId() || playerId === 'human') return 'human';
    if (!STATE.players[playerId]) return 'human'; // fallback
    return STATE.players[playerId].ui_zone || 'human';
}

function animarFichasAlCentro(cantidad, originZoneStr, isPending = false) {
    const { potChipsContainer, pendingPotChipsContainer, chipsLayer } = getElementsForChips();
    const targetContainer = isPending && pendingPotChipsContainer ? pendingPotChipsContainer : potChipsContainer;

    if (!targetContainer || !chipsLayer) return;

    // Valores permitidos de fichas (Luxury mapping)
    const chipValues = [700, 350, 150, 50];
    let remaining = cantidad;
    const chipsToGenerate = [];

    // Desglosar
    for (let cv of chipValues) {
        if (remaining <= 0) break;
        while (remaining >= cv) {
            chipsToGenerate.push(cv);
            remaining -= cv;
        }
    }
    // Si quedan picos raros, agregar ficha comodín
    if (remaining > 0) chipsToGenerate.push(50);

    const destRect = potChipsContainer.getBoundingClientRect();
    const destX = destRect.left + destRect.width / 2;
    const destY = destRect.top + destRect.height / 2;

    let delay = 0;

    // Origin Zone map
    const originMap = {
        'human': document.getElementById('human-player'),
        'bot1': document.getElementById('bot-1'),
        'bot2': document.getElementById('bot-2'),
        'bot3': document.getElementById('bot-3')
    };

    // Fallback al mismo pozo si no se encuentra
    let originEl = originMap[originZoneStr] || potChipsContainer;
    const originRect = originEl.getBoundingClientRect();
    let startX = originRect.left + originRect.width / 2;
    let startY = originRect.top + originRect.height / 2;

    chipsToGenerate.forEach((val, idx) => {
        setTimeout(() => {
            // Ficha en el layer de animaciones
            const flyingChip = document.createElement('div');
            flyingChip.className = `moche-chip chip-${val} chip-flying`;
            flyingChip.textContent = val >= 1000 ? (val / 1000).toFixed(1) + 'K' : val;

            // Random offset para el origen
            const offsetStartX = startX + (Math.random() * 40 - 20);
            const offsetStartY = startY + (Math.random() * 40 - 20);

            // Random offset para el destino en el pozo
            const potOffsetX = (Math.random() * 30 - 15);
            const potOffsetY = (Math.random() * 20 - 10);

            // CSS Anim Properties
            flyingChip.style.left = '0';
            flyingChip.style.top = '0';
            flyingChip.style.setProperty('--start-x', `${offsetStartX}px`);
            flyingChip.style.setProperty('--start-y', `${offsetStartY}px`);
            flyingChip.style.setProperty('--end-x', `${destX + potOffsetX}px`);
            flyingChip.style.setProperty('--end-y', `${destY + potOffsetY}px`);
            // random rotation
            flyingChip.style.setProperty('--rot', `${Math.random() * 360}deg`);
            flyingChip.style.animation = `chip-throw 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards`;

            chipsLayer.appendChild(flyingChip);

            // Al terminar la animación de volar, crear ficha estática en el pot y eliminar el flying
            setTimeout(() => {
                const staticChip = document.createElement('div');
                staticChip.className = `moche-chip chip-${val}`;
                staticChip.textContent = val >= 1000 ? (val / 1000).toFixed(1) + 'K' : val;
                // Random position stacked inside pot
                staticChip.style.marginLeft = `${potOffsetX}px`;
                staticChip.style.marginBottom = `${potOffsetY + (targetContainer.querySelectorAll('.moche-chip').length * 2)}px`;
                staticChip.style.transform = `rotate(${Math.random() * 360}deg)`;

                targetContainer.appendChild(staticChip);
                flyingChip.remove();

                if (!isPending) actualizarPozoTotal(STATE.apuestaActual);
            }, 450);

        }, delay);
        delay += 90; // Stagger
    });
}

function animarFichasRetornar(cantidad, destZoneStr) {
    const { pendingPotChipsContainer, chipsLayer } = getElementsForChips();
    if (!pendingPotChipsContainer || !chipsLayer) return;

    const staticChips = Array.from(pendingPotChipsContainer.querySelectorAll('.moche-chip'));
    const originRect = pendingPotChipsContainer.getBoundingClientRect();
    const startX = originRect.left + originRect.width / 2;
    const startY = originRect.top + originRect.height / 2;

    const destMap = {
        'human': document.getElementById('human-player'),
        'bot1': document.getElementById('bot-1'),
        'bot2': document.getElementById('bot-2'),
        'bot3': document.getElementById('bot-3')
    };
    const destEl = destMap[destZoneStr] || destMap['human'];
    const destRect = destEl.getBoundingClientRect();
    const destX = destRect.left + destRect.width / 2;
    const destY = destRect.top + destRect.height / 2;

    let delay = 0;

    staticChips.forEach((chipEl) => {
        const chipClassArr = Array.from(chipEl.classList).filter(c => c.startsWith('chip-') && c !== 'chip-flying' && c !== 'chip-win');
        const valClass = chipClassArr[0] || 'chip-50';

        setTimeout(() => {
            const flyingChip = document.createElement('div');
            flyingChip.className = `moche-chip ${valClass} chip-flying`;
            flyingChip.textContent = chipEl.textContent;

            const potOffsetX = (Math.random() * 40 - 20);
            const potOffsetY = (Math.random() * 40 - 20);

            flyingChip.style.left = '0';
            flyingChip.style.top = '0';
            flyingChip.style.setProperty('--start-x', `${startX + potOffsetX}px`);
            flyingChip.style.setProperty('--start-y', `${startY + potOffsetY}px`);
            flyingChip.style.setProperty('--end-x', `${destX}px`);
            flyingChip.style.setProperty('--end-y', `${destY}px`);
            flyingChip.style.setProperty('--rot', `${Math.random() * 360}deg`);

            // Apply the cancel animation
            flyingChip.style.animation = 'chip-return 0.5s ease-in forwards';

            chipsLayer.appendChild(flyingChip);
            chipEl.remove(); // Remove from pending container

            setTimeout(() => flyingChip.remove(), 550);

        }, delay);
        delay += 60;
    });
}

function actualizarPozoTotal(cantidad) {
    const { potTotal } = getElementsForChips();
    if (!potTotal) return;
    potTotal.innerText = `${cantidad} Bits`;
    potTotal.parentElement.classList.add('has-chips');
}

function animarPremioAlGanador(premio, winnerUIZone) {
    const { potTotal, potChipsContainer, chipsLayer, bitsDisplay } = getElementsForChips();
    if (!potChipsContainer || !chipsLayer) return;

    // Remover texto momentaneamente
    if (potTotal) {
        potTotal.innerText = `Ganador!`;
        potTotal.parentElement.classList.remove('has-chips');
    }

    const staticChips = Array.from(potChipsContainer.querySelectorAll('.moche-chip'));
    const originRect = potChipsContainer.getBoundingClientRect();
    const startX = originRect.left + originRect.width / 2;
    const startY = originRect.top + originRect.height / 2;

    const destMap = {
        'human': document.getElementById('human-player'),
        'bot1': document.getElementById('bot-1'),
        'bot2': document.getElementById('bot-2'),
        'bot3': document.getElementById('bot-3')
    };
    const destEl = destMap[winnerUIZone] || destMap['human'];
    const destRect = destEl.getBoundingClientRect();
    const destX = destRect.left + destRect.width / 2;
    const destY = destRect.top + destRect.height / 2;

    let delay = 0;

    // Todos viajan al ganador
    staticChips.forEach((chipEl) => {
        const chipClassArr = Array.from(chipEl.classList).filter(c => c.startsWith('chip-') && c !== 'chip-flying' && c !== 'chip-win');
        const valClass = chipClassArr[0] || 'chip-50';

        setTimeout(() => {
            const flyingChip = document.createElement('div');
            flyingChip.className = `moche-chip ${valClass} chip-flying chip-win`;
            flyingChip.textContent = chipEl.textContent;

            const potOffsetX = (Math.random() * 40 - 20);
            const potOffsetY = (Math.random() * 40 - 20);

            flyingChip.style.left = '0';
            flyingChip.style.top = '0';
            flyingChip.style.setProperty('--start-x', `${startX + potOffsetX}px`);
            flyingChip.style.setProperty('--start-y', `${startY + potOffsetY}px`);
            flyingChip.style.setProperty('--end-x', `${destX}px`);
            flyingChip.style.setProperty('--end-y', `${destY}px`);
            flyingChip.style.setProperty('--rot', `0deg`);

            // Reusar animacion pero inverso
            flyingChip.style.animation = 'chip-throw 0.6s ease-in forwards';

            chipsLayer.appendChild(flyingChip);
            chipEl.remove();

            // Absorcion Slot effect
            if (winnerUIZone === 'human') {
                setTimeout(() => {
                    if (!bitsDisplay) return;
                    const humanRect = destEl.getBoundingClientRect();
                    const bitsRect = bitsDisplay.getBoundingClientRect();

                    const absStartX = humanRect.left + humanRect.width / 2;
                    const absStartY = humanRect.top + humanRect.height / 2;
                    const absEndX = bitsRect.left + bitsRect.width / 2;
                    const absEndY = bitsRect.top + bitsRect.height / 2;

                    flyingChip.className = `moche-chip ${valClass} chip-flying`;
                    flyingChip.style.setProperty('--start-x', `${absStartX}px`);
                    flyingChip.style.setProperty('--start-y', `${absStartY}px`);
                    flyingChip.style.setProperty('--end-x', `${absEndX}px`);
                    flyingChip.style.setProperty('--end-y', `${absEndY}px`);
                    flyingChip.style.animation = `chip-absorb 0.5s ease-in forwards`;

                    // Blink en los bits
                    setTimeout(() => {
                        bitsDisplay.classList.remove('bits-absorb-flash');
                        void bitsDisplay.offsetWidth;
                        bitsDisplay.classList.add('bits-absorb-flash');
                        flyingChip.remove();
                    }, 450);

                }, 500);
            } else {
                setTimeout(() => flyingChip.remove(), 600);
            }

        }, delay);
        delay += 60;
    });
}

// ==========================================
// QUICK CHAT
// ==========================================
function initQuickChat() {
    const fab = document.getElementById('chat-btn');
    const menu = document.getElementById('chat-menu');
    const toast = document.getElementById('chat-toast');
    if (!fab || !menu || !toast) return;

    // Toggle menú al hacer clic en FAB
    fab.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = !menu.classList.contains('hidden');
        if (isOpen) {
            menu.classList.add('hidden');
            fab.classList.remove('open');
        } else {
            menu.classList.remove('hidden');
            fab.classList.add('open');
        }
    });

    // Cerrar al hacer clic fuera del menú
    document.addEventListener('click', () => {
        menu.classList.add('hidden');
        fab.classList.remove('open');
    });

    // Cada frase
    document.querySelectorAll('.chat-phrase').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const msg = btn.dataset.msg;
            menu.classList.add('hidden');
            fab.classList.remove('open');
            const myName = (window.USER_DATA && window.USER_DATA.nombre) || 'Tú';
            showChatToast(`💬 ${myName}: ${msg}`, toast);
            if (window.Telegram?.WebApp?.HapticFeedback) {
                window.Telegram.WebApp.HapticFeedback.impactOccurred('light');
            }
            // Emit to all players in the room if online
            if (isMultiplayer && mocheChannel) {
                mocheChannel.send({
                    type: 'broadcast',
                    event: 'moche_events',
                    payload: {
                        type: 'quick_message',
                        payload: {
                            room_id: window.USER_DATA.room_id,
                            sender: myName,
                            msg: msg
                        }
                    }
                });
            }
        });
    });
}

let _toastTimer = null;
function showChatToast(msg, toastEl) {
    if (!toastEl) return;
    toastEl.classList.remove('show', 'hidden');
    void toastEl.offsetWidth; // force reflow for re-animation
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
        toastEl.classList.remove('show');
        toastEl.classList.add('hidden');
    }, 3000);
}
