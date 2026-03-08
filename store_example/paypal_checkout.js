// paypal_checkout.js

function renderPaypalButtons() {
    const packages = [1, 5, 10, 20, 50];

    packages.forEach(amount => {
        const containerId = `#paypal-button-container-${amount}`;
        const container = document.querySelector(containerId);

        if (container) {
            paypal.Buttons({
                style: {
                    layout: 'horizontal',
                    color: 'gold',
                    shape: 'rect',
                    label: 'pay',
                    height: 40
                },
                // Flujo 1: Usuario presiona comprar y PayPal abre checkout
                createOrder: function (data, actions) {
                    if (!window.bitsStore) {
                        console.error('bitsStore no instanciado.');
                        return actions.reject();
                    }

                    const bitsAmount = window.bitsStore.convertUSDToBits(amount);

                    return actions.order.create({
                        purchase_units: [{
                            amount: {
                                value: amount.toString(),
                                currency_code: 'USD'
                            },
                            description: `${bitsAmount} Bits - Zona Jackpot 777`
                        }]
                    });
                },
                // Flujo 2: Usuario confirma pago, PayPal devuelve orderID y en onApprove
                onApprove: function (data, actions) {
                    return actions.order.capture().then(function (details) {
                        const orderId = details.id;
                        const payerEmail = details.payer.email_address;
                        const amountPaid = details.purchase_units[0].amount.value;

                        // Flujo 3: Verificación antifraude y registro
                        if (window.bitsStore) {
                            window.bitsStore.processPayment(orderId, amountPaid, payerEmail);
                        } else {
                            console.error("No se pudo contactar a bitsStore post-pago");
                        }
                    });
                },
                onError: function (err) {
                    console.error('Error procesando el PayPal UI:', err);
                    if (window.bitsStore) {
                        window.bitsStore.showNotification('Hubo un error contactando con PayPal', 'error');
                    }
                }
            }).render(containerId);
        }
    });
}

// Asegurarnos de renderizar cuando el Script inyectado de Paypal esté verdaderamente listo.
function initPaypalWhenReady() {
    if (window.paypal) {
        renderPaypalButtons();
    } else {
        // Poll every 100ms until PayPal SDK loads
        const interval = setInterval(() => {
            if (window.paypal) {
                clearInterval(interval);
                renderPaypalButtons();
            }
        }, 100);

        // Stop polling after 10 seconds to avoid infinite loop
        setTimeout(() => clearInterval(interval), 10000);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPaypalWhenReady);
} else {
    initPaypalWhenReady();
}
