import re
import os

filepath = 'static/js/moche.js'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Restore the socket listeners and kick logic
content = content.replace('''        if (STATE.phase === 'INTERCAMBIO') {
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
    });

}''', '''        if (STATE.phase === 'INTERCAMBIO') {
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
    });

    socket.on('kicked_from_room', (data) => {
        if (data.target_id === getMyId()) {
            alert(data.message);
            window.location.href = '/';
        }
    });

    socket.on('room_closed', (data) => {
        alert(data.message);
        window.location.href = '/';
    });

}

window.kickPlayer = function(targetId) {
    if (confirm("¿Seguro que quieres expulsar a este jugador?")) {
        socket.emit('kick_moche_player', { target_id: targetId });
    }
};''')

# 2. Restore the Waiting room list mapping
content = content.replace('''    // Lista de Jugadores
    const me = room.players.find(p => p.id === window.USER_DATA.telegram_id);
    const listHtml = room.players.map(p => `
        <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
            <span>${p.is_host ? '👑' : '👤'} ${p.name}</span>
            <span style="color:${p.ready ? '#00ff00' : '#ffaa00'}">${p.ready ? 'Listo' : 'Esperando...'}</span>
        </div>
    `).join('') + `
        <div style="margin-top:10px; border-top:1px solid #333; padding-top:10px; font-size:0.85em; color:#aaa;">
            La sala requiere ${room.total_slots} lugares llenos (incluyendo bots). Actuales: ${room.players.length + room.bots_count}/${room.total_slots}
        </div>
    `;
    document.getElementById('wr-players-list').innerHTML = listHtml;''', '''    // Lista de Jugadores
    const me = room.players.find(p => p.id === window.USER_DATA.telegram_id);
    const listHtml = room.players.map(p => {
        const isMeObj = p.id === window.USER_DATA.telegram_id;
        const canKick = me && me.is_host && !isMeObj;
        
        return `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 8px; border: 1px solid rgba(201,162,39,0.3);">
            <div style="display:flex; align-items:center; gap: 10px;">
                <span style="font-size: 1.2rem;">${p.is_host ? '👑' : '👤'}</span>
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
    document.getElementById('wr-players-list').innerHTML = listHtml;''')

# 3. Restore the Ready button logic
content = content.replace('''    if (me && me.is_host) {
        btnAction.innerText = 'Iniciar Partida';
        const allOthersReady = room.players.every(p => p.id === me.id || p.ready);
        const isFull = (room.players.length + room.bots_count) === room.total_slots;
        btnAction.disabled = !(allOthersReady && isFull);
        btnAction.onclick = () => { socket.emit('start_moche_game'); };''', '''    if (me && me.is_host) {
        btnAction.innerText = 'Iniciar Partida';
        const allOthersReady = room.players.every(p => p.id === me.id || p.ready);
        const hasMinimumPlayers = room.players.length >= 2 || room.total_slots > 0;
        btnAction.disabled = !allOthersReady;
        btnAction.onclick = () => { socket.emit('start_moche_game'); };''')

# 4. Restore the DOM variables
content = content.replace('''    btnMocheColor: document.getElementById('btn-moche-color'),
    turnIndicator: document.getElementById('turn-indicator'),
    overlay: document.getElementById('game-overlay'),''', '''    btnMocheColor: document.getElementById('btn-moche-color'),
    turnIndicator: document.getElementById('turn-indicator'),
    turnText: document.getElementById('turn-text'),
    turnTimer: document.getElementById('turn-timer'),
    turnTimerBar: document.getElementById('turn-timer-bar'),
    overlay: document.getElementById('game-overlay'),''')

# 5. Restore timer logic and replace the innerTexts safely for all occurrences
content = content.replace('''// =========================================
// FASE 2: JUEGO NORMAL
// =========================================
function procesarTurno() {''', '''// =========================================
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

function procesarTurno() {''')

# 6. Stop timer on empty deck
content = content.replace('''    if (STATE.deck.length === 0) {
        manejarMazoAgotado();
        return;
    }''', '''    if (STATE.deck.length === 0) {
        stopTurnTimer();
        manejarMazoAgotado();
        return;
    }
    
    stopTurnTimer();''')

# 7. Start timer on Human turn and process all DOM.turnIndicator.innerText correctly
# Let's use a regex carefully applied
def replace_inner_text(match):
    text = match.group(1)
    return f"if (DOM.turnText) DOM.turnText.innerText = {text}; else DOM.turnIndicator.innerText = {text};"

content = re.sub(r'DOM\.turnIndicator\.innerText\s*=\s*(.+?);', replace_inner_text, content)

# 8. Add `startTurnTimer(30)` after `actualizarBotonesJuego();` in `procesarTurno` only for human.
def add_timer_start(match):
    return match.group(0) + "\n        startTurnTimer(30);"

content = re.sub(r'(DOM\.turnIndicator\.style\.borderColor = "#00ff00";\s*actualizarBotonesJuego\(\);)', add_timer_start, content)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print('File updated successfully.')
