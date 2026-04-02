"""
paypal_service.py — Servicio de Pagos Automáticos via PayPal Payouts API
Soporta modo sandbox y live según la configuración de config.py
"""

import uuid
import requests
import config

# Endpoints
_BASE_SANDBOX = "https://api-m.sandbox.paypal.com"
_BASE_LIVE    = "https://api-m.paypal.com"

def _base_url():
    return _BASE_LIVE if getattr(config, 'PAYPAL_MODE', 'sandbox') == 'live' else _BASE_SANDBOX


def _get_access_token():
    """Obtiene un access_token de OAuth2 de PayPal."""
    url = f"{_base_url()}/v1/oauth2/token"
    resp = requests.post(
        url,
        auth=(config.PAYPAL_CLIENT_ID, config.PAYPAL_CLIENT_SECRET),
        data={"grant_type": "client_credentials"},
        headers={"Accept": "application/json"},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def execute_payout(email: str, amount_usd: float, reference_id: str = None, note: str = None):
    """
    Envía un pago a un correo de PayPal via la API de Payouts.

    Returns un dict con:
        success      (bool)
        batch_id     (str | None)  — PayPal Payout batch id
        status       (str)         — e.g. "PENDING", "SUCCESS"
        error_msg    (str | None)  — detalle del error si success=False
    """
    if not email or not amount_usd or amount_usd <= 0:
        return {"success": False, "batch_id": None, "status": "INVALID", "error_msg": "Email o monto inválido."}

    reference_id = reference_id or str(uuid.uuid4())
    note         = note or "Retiro de bits — GHOSTH PLAGUE CASINO"

    try:
        token = _get_access_token()
    except Exception as e:
        return {"success": False, "batch_id": None, "status": "AUTH_ERROR", "error_msg": f"Error de autenticación PayPal: {e}"}

    payload = {
        "sender_batch_header": {
            "sender_batch_id": reference_id,
            "email_subject":   "💰 Pago recibido de GHOSTH PLAGUE CASINO",
            "email_message":   "Has recibido un pago de retiro de la plataforma GHOSTH PLAGUE CASINO. ¡Gracias por jugar!"
        },
        "items": [
            {
                "recipient_type": "EMAIL",
                "amount": {
                    "value":    f"{amount_usd:.2f}",
                    "currency": "USD"
                },
                "receiver":   email,
                "note":       note,
                "sender_item_id": reference_id
            }
        ]
    }

    try:
        url = f"{_base_url()}/v1/payments/payouts"
        resp = requests.post(
            url,
            json=payload,
            headers={
                "Content-Type":  "application/json",
                "Authorization": f"Bearer {token}",
            },
            timeout=20,
        )

        data = resp.json()

        if resp.status_code == 201:
            batch_id = data.get("batch_header", {}).get("payout_batch_id", reference_id)
            status   = data.get("batch_header", {}).get("batch_status", "PENDING")
            return {"success": True, "batch_id": batch_id, "status": status, "error_msg": None}
        else:
            # Extract human-readable error from PayPal response
            msg = data.get("message") or data.get("error_description") or str(data)
            details = data.get("details", [])
            if details:
                msg = f"{msg}: {details[0].get('issue', '')} — {details[0].get('description', '')}"
            print(f"[PayPal] Payout error {resp.status_code}: {msg}")
            return {"success": False, "batch_id": None, "status": "FAILED", "error_msg": msg}

    except requests.exceptions.Timeout:
        return {"success": False, "batch_id": None, "status": "TIMEOUT", "error_msg": "Tiempo de espera agotado al conectar con PayPal."}
    except Exception as e:
        return {"success": False, "batch_id": None, "status": "EXCEPTION", "error_msg": str(e)}


def capture_order(order_id: str) -> dict:
    """
    Captura y verifica un pago de PayPal usando la Orders v2 API.
    Debe llamarse server-side ANTES de acreditar bits al jugador.

    Returns un dict con:
        success       (bool)
        status        (str)   — "COMPLETED", "FAILED", etc.
        amount_usd    (float) — monto confirmado por PayPal
        payer_email   (str)   — email del comprador
        error_msg     (str | None)
    """
    if not order_id:
        return {"success": False, "status": "INVALID", "amount_usd": 0, "payer_email": "", "error_msg": "Order ID vacío."}

    try:
        token = _get_access_token()
    except Exception as e:
        return {"success": False, "status": "AUTH_ERROR", "amount_usd": 0, "payer_email": "", "error_msg": f"Error de autenticación: {e}"}

    try:
        url = f"{_base_url()}/v2/checkout/orders/{order_id}/capture"
        resp = requests.post(
            url,
            headers={
                "Content-Type":  "application/json",
                "Authorization": f"Bearer {token}",
            },
            timeout=20,
        )

        data = resp.json()
        order_status = data.get("status", "")

        if resp.status_code in (200, 201) and order_status == "COMPLETED":
            # Extract confirmed amount from response
            try:
                purchase = data["purchase_units"][0]["payments"]["captures"][0]
                amount_usd = float(purchase["amount"]["value"])
                payer_email = data.get("payer", {}).get("email_address", "")
            except (KeyError, IndexError, ValueError):
                amount_usd = 0.0
                payer_email = ""
            return {
                "success": True,
                "status": "COMPLETED",
                "amount_usd": amount_usd,
                "payer_email": payer_email,
                "error_msg": None,
            }
        else:
            msg = data.get("message") or data.get("error_description") or f"Estado: {order_status}"
            details = data.get("details", [])
            if details:
                msg = f"{msg}: {details[0].get('issue', '')} — {details[0].get('description', '')}"
            print(f"[PayPal] capture_order error {resp.status_code}: {msg}")
            return {"success": False, "status": order_status or "FAILED", "amount_usd": 0, "payer_email": "", "error_msg": msg}

    except requests.exceptions.Timeout:
        return {"success": False, "status": "TIMEOUT", "amount_usd": 0, "payer_email": "", "error_msg": "Timeout al capturar el pago con PayPal."}
    except Exception as e:
        return {"success": False, "status": "EXCEPTION", "amount_usd": 0, "payer_email": "", "error_msg": str(e)}
