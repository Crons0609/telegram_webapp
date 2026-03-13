document.addEventListener('DOMContentLoaded', () => {
    const packages = [
        { price: '1.00', bits: 1000, bonus: '0', icon: 'fa-coins' },
        { price: '5.00', bits: 5500, bonus: '500', icon: 'fa-gem' },
        { price: '10.00', bits: 12000, bonus: '2000', icon: 'fa-crown' },
        { price: '20.00', bits: 26000, bonus: '6000', icon: 'fa-star' },
        { price: '50.00', bits: 70000, bonus: '20000', icon: 'fa-dragon' }
    ];

    const packagesContainer = document.getElementById('packages');

    packages.forEach((pkg, index) => {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
            <div class="icon"><i class="fas ${pkg.icon}"></i></div>
            <div class="price">$${pkg.price}</div>
            <div class="bits">🎟️ ${pkg.bits.toLocaleString()} Bits</div>
            ${pkg.bonus > 0 ? `<div class="bonus">+${pkg.bonus} bonus</div>` : ''}
            <div id="paypal-button-${index + 1}" class="paypal-button-container"></div>
        `;
        packagesContainer.appendChild(card);
    });

    // Sonido opcional (se activa con el primer clic)
    let audioCtx = null;
    let soundEnabled = false;

    function playCoinSound() {
        if (!soundEnabled) return;
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(800, audioCtx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(400, audioCtx.currentTime + 0.2);
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.3);
    }

    function enableSound() {
        if (!soundEnabled) {
            soundEnabled = true;
            console.log('Sonido activado');
        }
    }

    if (typeof paypal !== 'undefined') {
        packages.forEach((pkg, index) => {
            const containerId = `paypal-button-${index + 1}`;
            paypal.Buttons({
                fundingSource: paypal.FUNDING.PAYPAL,
                style: { shape: 'pill', color: 'gold', layout: 'vertical', label: 'paypal', height: 45 },
                createOrder: function(data, actions) {
                    enableSound();
                    return actions.order.create({
                        purchase_units: [{
                            description: `Compra de ${pkg.bits} bits para Zona Jackpot 777`,
                            amount: { currency_code: 'USD', value: pkg.price },
                            custom_id: pkg.bits.toString()
                        }]
                    });
                },
                onApprove: function(data, actions) {
                    return actions.order.capture().then(function(details) {
                        console.log('Pago completado:', details);
                        
                        // Enviar al backend
                        fetch('/api/paypal/capture', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                order_id: details.id,
                                amount_usd: parseFloat(pkg.price),
                                bits_amount: pkg.bits
                            })
                        })
                        .then(res => res.json())
                        .then(apiData => {
                            if (apiData.success) {
                                playCoinSound();
                                showNotification(`¡Gracias ${details.payer.name.given_name}! Se añadieron ${pkg.bits} bits.`, 'success');
                            } else {
                                showNotification('Error al registrar pago en el servidor.', 'error');
                            }
                        })
                        .catch(err => {
                            console.error('Error backend:', err);
                            showNotification('Error contactando al servidor.', 'error');
                        });
                    });
                },
                onCancel: function() {
                    showNotification('Pago cancelado. Puedes intentar nuevamente.', 'info');
                },
                onError: function(err) {
                    console.error('Error en PayPal:', err);
                    showNotification('Ocurrió un error al procesar el pago.', 'error');
                }
            }).render(`#${containerId}`);
        });
    } else {
        console.error('El SDK de PayPal no se cargó correctamente.');
    }

    function showNotification(message, type) {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
            color: white;
            padding: 15px 20px;
            border-radius: 10px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 1000;
            font-weight: 600;
            animation: slideIn 0.3s ease, fadeOut 0.5s ease 4.5s forwards;
            border-left: 4px solid #ffd700;
        `;
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 5000);
    }

    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes fadeOut { to { opacity: 0; transform: translateX(100%); } }
    `;
    document.head.appendChild(style);
});