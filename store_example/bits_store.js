// bits_store.js
import supabase from './supabase_client.js';

class BitsStore {
    constructor() {
        this.currentUser = null;
        this.basePackages = {
            1: 1000,
            5: 5500,
            10: 12000,
            20: 26000,
            50: 70000
        };
        this.notificationTimer = null;
    }

    initTelegram() {
        // Inicializar Telegram WebApp API
        if (window.Telegram && window.Telegram.WebApp) {
            this.tg = window.Telegram.WebApp;
            this.tg.expand();
            this.tg.ready();

            // Extraer datos del usuario (o usar dummy si se prueba fuera de TG)
            const initDataUnsafe = this.tg.initDataUnsafe || {};
            const user = initDataUnsafe.user || {
                id: '123456789',
                username: 'JugadorPrueba',
                first_name: 'Prueba'
            };

            this.loginOrCreateUser(user);
        } else {
            console.error("Telegram WebApp API no disponible");
            // Fallback para pruebas locales en navegador
            this.loginOrCreateUser({
                id: '999999999',
                username: 'LocalDevUser',
                first_name: 'Local'
            });
        }
    }

    async loginOrCreateUser(tgUser) {
        try {
            // Verificar si el usuario ya existe basado en telegram_id
            const { data: user, error } = await supabase
                .from('users')
                .select('*')
                .eq('telegram_id', tgUser.id.toString())
                .maybeSingle();

            if (error) {
                console.error('Error buscando usuario:', error);
                this.showNotification('Error conectando a la base de datos', 'error');
                return;
            }

            if (user) {
                // El usuario ya existe, cargarlo en el estado actual
                this.currentUser = user;
            } else {
                // Crear usuario nuevo con valores predeterminados (Creación Automática)
                const { data: newUser, error: createError } = await supabase
                    .from('users')
                    .insert([{
                        telegram_id: tgUser.id.toString(),
                        username: tgUser.username || tgUser.first_name,
                        bits: 0,
                        experience: 0,
                        wins: 0,
                        vip_level: 0,
                        total_spent: 0
                    }])
                    .select()
                    .single();

                if (createError) throw createError;
                this.currentUser = newUser;
            }

            // Reflejar datos del usuario en la interfaz
            this.updateUI();
        } catch (error) {
            console.error('Error en loginOrCreateUser:', error);
            this.showNotification('Error al iniciar sesión', 'error');
        }
    }

    // Convertidor de USD a BITS
    convertUSDToBits(amount) {
        return this.basePackages[amount] || 0;
    }

    // Calculador del nivel VIP
    calculateVIPLevel(totalSpent) {
        if (totalSpent >= 1000) return 4;
        if (totalSpent >= 500) return 3;
        if (totalSpent >= 200) return 2;
        if (totalSpent >= 50) return 1;
        return 0; // VIP 0 default
    }

    // Procesar pago tras validación de PayPal
    async processPayment(orderId, amount, payerEmail) {
        if (!this.currentUser) {
            this.showNotification('Usuario no identificado. Reinicia la app.', 'error');
            return;
        }

        const amountNum = Number(amount);
        const bitsToAdd = this.convertUSDToBits(amountNum);

        if (bitsToAdd === 0) {
            this.showNotification('Paquete comprado no es válido.', 'error');
            return;
        }

        this.showNotification('Validando y procesando tu pago...', 'info');

        try {
            // 1. Verificación Antifraude: verificar si el paypal_order_id ya fue usado
            // Esto evita que un mismo ID de PayPal cobre Bits múltiples veces o onApprove duplicado
            const { data: existingPayment, error: checkError } = await supabase
                .from('payments')
                .select('id')
                .eq('paypal_order_id', orderId)
                .maybeSingle();

            if (existingPayment) {
                this.showNotification('Transacción cancelada: Este pago ya fue procesado previamente.', 'error');
                return;
            }

            // 2. Registrar Transacción en payments antes de sumar bits al usuario 
            // Esto servirá de auditoría y bloquea a través de Unique Constraint en db de ser activado múltiples veces simultánteas
            const { data: payment, error: insertError } = await supabase
                .from('payments')
                .insert([{
                    user_id: this.currentUser.id,
                    paypal_order_id: orderId,
                    paypal_payer_email: payerEmail,
                    amount: amountNum,
                    bits: bitsToAdd,
                    status: 'COMPLETED'
                }])
                .select()
                .single();

            if (insertError) {
                if (insertError.code === '23505') { // Código de violación UNIQUE constraint de PostgreSQL
                    this.showNotification('Error antifraude: Pago ya registrado.', 'error');
                } else {
                    console.error('Error guardando pago en BD:', insertError);
                    this.showNotification('Error guardando transacción de pago.', 'error');
                }
                return;
            }

            // 3. Actualización de Bits y Sistema VIP del Usuario Automático (Atómico/Consistente)
            const newTotalSpent = Number(this.currentUser.total_spent) + amountNum;
            const newVipLevel = this.calculateVIPLevel(newTotalSpent);
            const newBits = Number(this.currentUser.bits) + bitsToAdd;

            const { data: updatedUser, error: updateError } = await supabase
                .from('users')
                .update({
                    bits: newBits,
                    total_spent: newTotalSpent,
                    vip_level: newVipLevel
                })
                .eq('id', this.currentUser.id)
                .select()
                .single();

            if (updateError) {
                console.error('Error actualizando usuario tras el pago:', updateError);
                // Si la BD guardó pago pero falló acá, el estado quedará asíncrono para bits,
                // por eso recomiendan que esta sumatoria la haga un Stored Procedure.
                // Sin embargo aquí se maneja a nivel código como solución transaccional frontend-first (solo ejemplo didáctico).
                this.showNotification('Hubo un error añadiendo tus bits pero la transacción quedó registrada. Contacte soporte.', 'error');
                return;
            }

            // Actualizar estado del app y UI
            this.currentUser = updatedUser;
            this.updateUI();

            // Experiencia de Usuario: Feedback de la sumatoria
            this.showNotification(`Pago completado. +${bitsToAdd} Bits añadidos a tu cuenta`, 'success');

        } catch (error) {
            console.error('Error imprevisto procesando pago:', error);
            this.showNotification('Error inesperado procesando tu compra.', 'error');
        }
    }

    updateUI() {
        if (!this.currentUser) return;

        const usernameEl = document.getElementById('user-username');
        const bitsEl = document.getElementById('user-bits');
        const vipEl = document.getElementById('user-vip');

        if (usernameEl) {
            usernameEl.innerText = this.currentUser.username;
        }

        if (bitsEl) {
            bitsEl.innerText = this.currentUser.bits.toLocaleString() + ' Bits';
        }

        if (vipEl) {
            vipEl.innerText = 'VIP ' + this.currentUser.vip_level;
            vipEl.className = 'vip-badge vip-' + this.currentUser.vip_level;
        }
    }

    // Gestionar la ventana flotante de notificaciones
    showNotification(message, type = 'info') {
        const notif = document.getElementById('notification');
        if (!notif) return;

        notif.innerText = message;

        // Reset class para forzar animacion
        notif.className = 'notification';
        void notif.offsetWidth;

        notif.classList.add(type);
        notif.classList.add('show');

        if (this.notificationTimer) {
            clearTimeout(this.notificationTimer);
        }

        this.notificationTimer = setTimeout(() => {
            notif.classList.remove('show');
        }, 5000); // mostrar por 5 segs
    }
}

// Inicializar de forma global la clase para que su instancia la consuma Paypal_checkout
function initStore() {
    window.bitsStore = new BitsStore();
    window.bitsStore.initTelegram();
}

// Asegurarse de cargar al inicializarse el DOM 
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStore);
} else {
    initStore();
}
