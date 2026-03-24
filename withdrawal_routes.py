"""
withdrawal_routes.py — Sistema de Retiro de Bits para Ghost Plague Casino
Conversión: 1000 bits = 1 USD
"""

from flask import Blueprint, render_template, request, session, jsonify, redirect, url_for
import database
import config

withdrawal_bp = Blueprint('withdrawal', __name__, url_prefix='/withdraw')


def _get_current_user():
    """Returns the current user dict from session (telegram_id required)."""
    telegram_id = session.get('telegram_id') or request.args.get('telegram_id')
    if not telegram_id:
        return None, None
    try:
        telegram_id = int(telegram_id)
    except (ValueError, TypeError):
        return None, None
    user = database.obtener_usuario(telegram_id)
    return telegram_id, user


# ─── PAGES ──────────────────────────────────────────────────────────────────

@withdrawal_bp.route('/')
def withdraw_page():
    """Main withdrawal page for players."""
    telegram_id, user = _get_current_user()
    if not user:
        return redirect('/')
    
    historial = database.obtener_retiros_usuario(str(telegram_id))[:10]
    limits_info = database.verificar_limite_retiro(str(telegram_id))
    
    bits = int(user.get('bits', 0))
    min_bits = config.WITHDRAWAL_MIN_BITS
    rate = config.BITS_TO_USD_RATE
    max_usd_day = config.WITHDRAWAL_MAX_USD_DAY
    max_per_day = config.WITHDRAWAL_MAX_PER_DAY
    
    return render_template(
        'withdraw.html',
        user=user,
        telegram_id=telegram_id,
        bits=bits,
        min_bits=min_bits,
        rate=rate,
        max_usd_day=max_usd_day,
        max_per_day=max_per_day,
        historial=historial,
        limits_info=limits_info,
    )


# ─── API ─────────────────────────────────────────────────────────────────────

@withdrawal_bp.route('/api/request', methods=['POST'])
def api_request_withdrawal():
    """
    Creates a new withdrawal request (P2P or PayPal automatic payout).
    Validates balance, daily limits, and minimum amounts.
    For PayPal: triggers instant payout via PayPal Payouts API.
    Body: {telegram_id, bits, method, paypal_email (optional)}
    """
    import paypal_service

    data = request.get_json() or {}
    telegram_id = data.get('telegram_id') or session.get('telegram_id')
    bits_str = data.get('bits', 0)
    method = data.get('method', 'p2p')
    paypal_email = (data.get('paypal_email') or '').strip()

    # ── 1. Validate user ──────────────────────────────────────────────────────
    try:
        telegram_id = int(telegram_id)
    except (ValueError, TypeError):
        return jsonify({'success': False, 'message': 'Usuario no identificado.'}), 401

    user = database.obtener_usuario(telegram_id)
    if not user:
        return jsonify({'success': False, 'message': 'Usuario no encontrado.'}), 404

    # ── 2. Validate bits amount ───────────────────────────────────────────────
    try:
        bits = int(bits_str)
    except (ValueError, TypeError):
        return jsonify({'success': False, 'message': 'Cantidad de bits inválida.'}), 400

    if bits < config.WITHDRAWAL_MIN_BITS:
        return jsonify({
            'success': False,
            'message': f'El mínimo de retiro es {config.WITHDRAWAL_MIN_BITS:,} bits (${config.WITHDRAWAL_MIN_BITS / config.BITS_TO_USD_RATE:.2f} USD).'
        }), 400

    current_bits = int(user.get('bits', 0))
    if bits > current_bits:
        return jsonify({
            'success': False,
            'message': f'Saldo insuficiente. Tienes {current_bits:,} bits disponibles.'
        }), 400

    # ── 3. Calculate USD ──────────────────────────────────────────────────────
    usd = bits / config.BITS_TO_USD_RATE

    if usd > config.WITHDRAWAL_MAX_USD_DAY:
        return jsonify({
            'success': False,
            'message': f'El máximo por retiro es ${config.WITHDRAWAL_MAX_USD_DAY:.2f} USD ({int(config.WITHDRAWAL_MAX_USD_DAY * config.BITS_TO_USD_RATE):,} bits).'
        }), 400

    # ── 4. Anti-fraud: daily limits ───────────────────────────────────────────
    limits = database.verificar_limite_retiro(str(telegram_id))
    if not limits['ok']:
        return jsonify({'success': False, 'message': limits['blocked']}), 429

    # ── 5. Validate PayPal email if method is paypal ──────────────────────────
    if method == 'paypal' and not paypal_email:
        return jsonify({'success': False, 'message': 'Debes ingresar tu email de PayPal.'}), 400

    # ── 6. Handle PayPal automatic payout ────────────────────────────────────
    username = user.get('username') or user.get('nombre') or str(telegram_id)
    nombre   = user.get('nombre') or user.get('first_name') or username

    paypal_batch_id = None
    tx_status = 'pending'
    success_msg = 'Solicitud enviada. Recibirás una notificación cuando sea procesada.'

    if method == 'paypal':
        payout_result = paypal_service.execute_payout(
            email=paypal_email,
            amount_usd=usd,
            note=f'Retiro de {bits:,} bits — Zona Jackpot 777'
        )

        if not payout_result['success']:
            # Payment failed — do NOT deduct bits, reject immediately
            friendly_err = payout_result.get('error_msg', 'Error desconocido.')
            return jsonify({
                'success': False,
                'message': f'❌ Error al procesar el pago con PayPal: {friendly_err}'
            }), 402

        # Payment succeeded — mark as completed and deduct bits
        paypal_batch_id = payout_result.get('batch_id')
        tx_status = 'completed'
        success_msg = f'✅ ¡Pago de ${usd:.2f} USD enviado a {paypal_email}! Revisa tu cuenta de PayPal.'

        # Deduct bits immediately after successful payout
        try:
            database.descontar_bits(str(telegram_id), bits)
        except Exception as e:
            print(f"[Withdrawal] CRITICAL: payout succeeded but bits deduction failed: {e}")
            # Log but don't fail the request since money was already sent

    elif method == 'p2p':
        # For P2P, we deduct bits IMMEDIATELY
        try:
            database.descontar_bits(str(telegram_id), bits)
        except Exception as e:
            return jsonify({'success': False, 'message': '❌ No se pudieron descontar los bits. Intenta de nuevo.'}), 500

    # ── 7. Create the withdrawal record in Firebase ───────────────────────────
    # If P2P, get selected admin
    admin_id = data.get('admin_id') 
    
    tx_id = database.crear_solicitud_retiro(
        telegram_id=str(telegram_id),
        username=username,
        nombre=nombre,
        bits=bits,
        usd=usd,
        method=method,
        paypal_email=paypal_email,
        status=tx_status,
        paypal_batch_id=paypal_batch_id,
    )
    
    # Store assigned admin if provided
    if method == 'p2p' and admin_id:
        k, _ = database._find_retiro_key(tx_id)
        if k:
            database.patch_fb(f'retiros/{k}', {'assigned_admin': str(admin_id)})

    # ── 8. Notify user and assigned admin via Telegram ───────────────────────────
    try:
        if method == 'paypal' and tx_status == 'completed':
            database.notify_withdrawal_approved(str(telegram_id), bits, usd, 'paypal', tx_id)
        elif method == 'p2p':
            database.notify_withdrawal_received(str(telegram_id), bits, usd, method, tx_id)
            # Notify the assigned admin personally
            if admin_id:
                try:
                    admin_msg = (
                        f"🚨 <b>Nuevo Retiro P2P Asignado a Ti</b>\n\n"
                        f"👤 Jugador: {nombre} (@{username})\n"
                        f"🪙 Bits: {bits:,}\n"
                        f"💵 Equivalente a pagar: ${usd:.2f} USD\n\n"
                        f"Por favor, revisa el panel de administrador para completarlo."
                    )
                    database.send_telegram_notification(admin_id, "Gestión de Retiros", admin_msg)
                except Exception as e:
                    print(f"Failed to notify P2P admin {admin_id}: {e}")
    except Exception:
        pass

    return jsonify({
        'success': True,
        'tx_id': tx_id,
        'bits': bits,
        'usd': usd,
        'method': method,
        'auto_paid': (tx_status == 'completed'),
        'message': success_msg
    })

@withdrawal_bp.route('/api/p2p_admins')
def api_p2p_admins():
    """Devuelve la lista de administradores disponibles para transacciones P2P."""
    admins = database.get_fb("Administradores") or {}
    
    admin_list = []
    for telegram_id, admin_data in admins.items():
        if admin_data.get('rol') in ['admin', 'superadmin']:
            admin_list.append({
                'telegram_id': telegram_id,
                'nombre': admin_data.get('nombre', 'Administrador')
            })
            
    return jsonify({'success': True, 'admins': admin_list})


@withdrawal_bp.route('/api/history')
def api_withdrawal_history():
    """Returns the withdrawal history for the current user."""
    telegram_id = request.args.get('telegram_id') or session.get('telegram_id')
    if not telegram_id:
        return jsonify({'success': False, 'message': 'No autenticado'}), 401
    historial = database.obtener_retiros_usuario(str(telegram_id))
    return jsonify({'success': True, 'history': historial})


@withdrawal_bp.route('/api/limits')
def api_withdrawal_limits():
    """Returns daily limit status for the current user."""
    telegram_id = request.args.get('telegram_id') or session.get('telegram_id')
    if not telegram_id:
        return jsonify({'success': False, 'message': 'No autenticado'}), 401
    limits = database.verificar_limite_retiro(str(telegram_id))
    return jsonify({
        'success': True,
        'limits': {
            **limits,
            'max_per_day': config.WITHDRAWAL_MAX_PER_DAY,
            'max_usd_day': config.WITHDRAWAL_MAX_USD_DAY,
            'min_bits': config.WITHDRAWAL_MIN_BITS,
            'rate': config.BITS_TO_USD_RATE,
        }
    })
