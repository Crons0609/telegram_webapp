/**
 * bet_slip.js
 * Maneja la interfaz del boleto de apuestas (Bet Slip) para todos los deportes (NFL, Futbol, F1, MLB).
 */

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
    if (modal) {
      modal.classList.add('open');
    }
  },

  close() {
    this.currentMatchId = null;
    this.currentTeamChoice = null;
    this.currentMatchName = null;
    this.currentOdd = null;

    const modal = document.getElementById('betslip');
    if (modal) {
      modal.classList.remove('open');
    }
    
    const amountEl = document.getElementById('bet-amount');
    if (amountEl) amountEl.value = '';
  },

  showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `sm-toast show ${type}`;
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
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

    // Bloquear botón temporalmente
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
          amount: amount
        })
      });

      const data = await res.json();
      
      if (btn) btn.disabled = false;

      if (data.success) {
        this.showToast('✅ ¡Apuesta realizada con éxito!');
        this.close();
        
        // Disparar evento global para actualizar balance en UI si es necesario
        window.dispatchEvent(new CustomEvent('balanceUpdated', { detail: { new_balance: data.new_balance } }));
        
        // Actualizar UI del perfil
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

// Exponer globalmente las funciones requeridas por los HTML attributes (onclick)
window.openBetSlip = function(matchId, teamChoice, matchName, odd) {
  BetSlipAPI.open(matchId, teamChoice, matchName, odd);
};

window.closeBetSlip = function() {
  BetSlipAPI.close();
};

window.submitBet = function() {
  BetSlipAPI.submit();
};
