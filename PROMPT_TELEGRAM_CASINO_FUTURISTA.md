# Prompt ultra detallado (listo para pegar en un generador de código)

Quiero que actúes como **arquitecto front-end senior + integrador Telegram Web App + game developer** y me entregues un **proyecto completo, funcional y profesional** de una **Web App para Telegram** que simule un **casino online estilo Las Vegas futurista**.

> ⚠️ No quiero una demo genérica. Quiero un resultado **premium, inmersivo y de nivel producción**, con estructura limpia, módulos reutilizables, rendimiento optimizado y documentación clara.

---

## 1) Objetivo de producto

Construye una experiencia de casino con:
- Estética de lujo futurista (neones, metales pulidos, hologramas, glassmorphism, brillos y profundidad 3D).
- Slot Machine principal completamente interactiva.
- Al ganar: **lluvia espectacular de billetes + monedas + confeti + chispas** con física realista y sonido sincronizado.
- Sistema de **puntos/saldo** integrado para que:
  - un bot de Telegram pueda **recargar puntos** a usuarios,
  - la Web App consulte el saldo actualizado,
  - y cuando el usuario gane en tragamonedas se **incrementen puntos** y se notifique al backend/bot.

---

## 2) Stack técnico y restricciones

- HTML5 + CSS3 + JavaScript moderno (ES6 modules).
- Sin frameworks pesados obligatorios (puedes usar librerías ligeras opcionales si justificas rendimiento).
- Animaciones principales con CSS + Canvas (o WebGL con fallback Canvas).
- Código listo para integrar en repositorio existente.
- No hardcodear secretos/tokens.
- Todo debe funcionar bien dentro de **Telegram Web App** (móvil y desktop).

---

## 3) Estructura de carpetas obligatoria

Genera exactamente esta estructura (agrega archivos extra solo si aportan valor):

```txt
/
├─ index.html
├─ README.md
├─ CHANGELOG.md                  (opcional pero recomendado)
├─ package.json                  (opcional si incluyes scripts de build/lint)
├─ /assets
│  ├─ /css
│  │  ├─ base.css
│  │  ├─ layout.css
│  │  ├─ components.css
│  │  ├─ effects.css
│  │  └─ responsive.css
│  ├─ /js
│  │  ├─ main.js
│  │  ├─ game.js
│  │  ├─ animations.js
│  │  ├─ particles.js
│  │  ├─ ui.js
│  │  ├─ telegram-integration.js
│  │  ├─ points-service.js
│  │  └─ utils.js
│  ├─ /img
│  │  ├─ logo-casino.svg
│  │  ├─ symbols/*.svg
│  │  ├─ coins/*.svg
│  │  └─ bills/*.svg
│  └─ /audio
│     ├─ bg-loop.mp3
│     ├─ spin.mp3
│     ├─ reel-stop.mp3
│     ├─ win.mp3
│     └─ coin-drop.mp3
└─ /docs
   └─ telegram-api.md            (opcional, recomendado)
```

Si usas Sass:
- incluir `/assets/scss/*.scss` y dejar también CSS compilado final en `/assets/css/`.

---

## 4) Dirección artística (obligatoria, sin desviaciones)

### Paleta visual exacta
Usar variables CSS en `:root` con estos colores:
- Dorado metálico: `#FFD700`
- Rojo neón: `#FF2D2D`
- Púrpura cósmico: `#8A2BE2`
- Azul eléctrico: `#00E5FF`
- Cian acento: `#00FFC6`
- Negro profundo: `#0B0B0F`

### Estilo global
- Fondo con gradientes dinámicos (radial + linear), ruido fino y destellos metálicos en movimiento lento.
- Marcos dorados con glow neón y reflejos dinámicos.
- Tarjetas tipo vidrio translúcido (glassmorphism).
- Botones 3D con:
  - volumen visual,
  - brillo especular,
  - sombra suave,
  - hover/tap con microrebote + glow.
- Logo casino animado en hero:
  - parpadeo neón,
  - entrada con rebote elástico,
  - destello barrido horizontal.

### Tipografías
- Principal: `Inter` o `Manrope`.
- Display/logo: fuente futurista (incluye `@font-face` + fallback segura).

---

## 5) UX/UI obligatoria

### Pantalla principal
- Header con logo animado y estado del usuario.
- Main con máquina tragamonedas central.
- Panel lateral o inferior (según viewport) con:
  - saldo/puntos actuales,
  - historial de tiradas recientes,
  - botones de acción (Girar, Apuesta +/-, Música, Max Visual, Modo Ahorro).
- Footer con mensajes de juego responsable y estado de conexión Telegram.

### Slot Machine
- Mínimo 3 reels y 3+ símbolos (SVG).
- Animación de giro con sensación 3D (perspectiva, easing realista, motion blur opcional).
- Detención secuencial de reels con sonido sincronizado.
- Lógica de victoria/derrota clara y configurable.

### Modal de victoria premium
- Modal holográfico animado con:
  - texto de victoria,
  - contador de recompensa que aumenta con easing,
  - CTA para seguir jugando.

---

## 6) Sistema de puntos recargables por bot (requisito crítico)

Implementar flujo completo y modular para puntos:

### Frontend (Web App)
Crear `points-service.js` con funciones:
- `getUserPoints(userId)`
- `addPoints(userId, amount, reason)`
- `deductPoints(userId, amount, reason)`
- `syncPointsWithBot(payload)`

### Integración sugerida con backend/bot
Usar endpoints de ejemplo (mockeables):
- `GET /api/points/:telegramUserId` → retorna saldo
- `POST /api/points/recharge` → recarga por bot/admin
- `POST /api/points/transaction` → registra win/loss

### Reglas de negocio mínimas
- El usuario necesita puntos para girar (`costPerSpin`).
- Si gana:
  - sumar `winReward` al saldo,
  - mostrar animación de incremento de puntos,
  - enviar transacción al backend.
- Si pierde:
  - descontar costo de giro (si aplica),
  - persistir transacción.
- Proteger contra doble click / doble transacción con lock de estado (`isSpinning`).

### Integración Telegram
En `telegram-integration.js`:
- detectar `window.Telegram.WebApp`.
- inicializar con `Telegram.WebApp.ready()` y `expand()`.
- leer `initDataUnsafe.user` para `telegramUserId`.
- enviar eventos al bot con `Telegram.WebApp.sendData(JSON.stringify(...))` cuando:
  - inicia spin,
  - termina spin,
  - hay victoria,
  - cambia saldo.

Incluye fallback cuando se abre fuera de Telegram (modo navegador normal).

---

## 7) Efectos visuales y físicas (máxima calidad)

Implementar en `particles.js` + `animations.js`:

### Al ganar
- Lluvia de billetes + monedas en toda la pantalla:
  - sprites variados (tamaño/rotación/color),
  - gravedad,
  - resistencia del aire,
  - rebotes suaves al borde inferior,
  - giro continuo con ligera oscilación.
- Confeti y partículas brillantes combinadas.
- Halos de luz y flash breve detrás de la máquina.

### Rendimiento
- `requestAnimationFrame` obligatorio.
- Pool de objetos para evitar garbage excesivo.
- Límite dinámico de partículas según capacidad del dispositivo.
- Toggle:
  - `Max Visual` (muchos efectos),
  - `Modo Ahorro` (menos partículas/blur).
- Si WebGL no está disponible, fallback automático a Canvas 2D.

---

## 8) Audio y microinteracciones

- Música de fondo opcional (loop), volumen configurable, mute global.
- Sonidos por evento: spin, stop, win, caída de monedas.
- Respetar autoplay policies (activar audio tras interacción del usuario).
- Haptics/Vibration:
  - `navigator.vibrate` cuando gane,
  - `Telegram.WebApp.HapticFeedback` si está disponible.
- Respetar `prefers-reduced-motion` y ofrecer opción “Reducir efectos”.

---

## 9) Accesibilidad y semántica (obligatorio)

- HTML semántico: `header`, `main`, `section`, `aside`, `footer`, `button`, `nav`.
- ARIA correcto:
  - `aria-live` para resultados del spin,
  - labels accesibles en botones.
- Navegable por teclado (focus visible claro).
- Contraste suficiente en texto/controles.
- Opción para desactivar animaciones intensas y audio.

---

## 10) Seguridad y calidad de código

- Sanitizar cualquier dato dinámico antes de renderizar.
- No usar `innerHTML` inseguro para entradas externas.
- Manejo robusto de errores de red (try/catch en fetch, estados de retry).
- Evitar variables globales; usar módulos y exports/imports.
- Comentarios útiles (no ruido), explicando cómo ajustar:
  - tasa de victoria,
  - cantidad de partículas,
  - costo por giro,
  - recompensas de puntos.

---

## 11) CSS modular obligatorio

Distribución esperada:
- `base.css`: reset, tokens, tipografía, utilidades base.
- `layout.css`: estructura principal, grid/flex, secciones.
- `components.css`: botones, cards, slot, modal, badges.
- `effects.css`: glows, neones, animaciones, partículas helper, blend overlays.
- `responsive.css`: breakpoints mobile/tablet/desktop + safe-area Telegram.

Usar variables CSS para:
- colores,
- sombras,
- radios,
- spacing,
- duraciones/easing.

---

## 12) JS modular obligatorio

Implementa responsabilidades claras:
- `main.js`: bootstrap de app.
- `ui.js`: render de estado, modales, toggles visuales/audio.
- `game.js`: lógica de slot, probabilidades, payout, estado de spin.
- `animations.js`: timeline de entradas/salidas, transiciones premium.
- `particles.js`: motor de partículas/billetes/monedas.
- `telegram-integration.js`: API Telegram Web App.
- `points-service.js`: saldo y transacciones de puntos.
- `utils.js`: helpers (throttle, clamp, easing, formato números).

---

## 13) Modo responsive + Telegram container

- Mobile-first real.
- Touch targets mínimos de 44px.
- Respetar `env(safe-area-inset-*)` para notch/barra inferior.
- Layout usable en Telegram desktop y móvil sin solapamientos.
- Evitar overflow horizontal.

---

## 14) README obligatorio (muy claro)

Incluye:
1. Requisitos.
2. Cómo ejecutar local.
3. Estructura de carpetas.
4. Cómo integrar con Telegram Web App.
5. Cómo conectar API de puntos (recarga por bot + premios por win).
6. Variables de configuración (audio, efectos, probabilidades).
7. Modo producción (minificación/build).
8. Solución de problemas comunes.

---

## 15) Scripts de calidad (si usas npm)

Agregar scripts sugeridos:
- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm run format`

Y linters/formateo básico (ESLint/Prettier opcional).

---

## 16) Entrega esperada

Devuélveme:
1. **Código completo** (todos los archivos).
2. Proyecto funcional con demo de slot machine.
3. Sistema de puntos activo (mock API si no hay backend real).
4. Evento de victoria que incremente puntos y dispare lluvia de billetes/monedas.
5. README de integración Telegram + bot.
6. Comentarios clave de personalización.

---

## 17) Criterios de aceptación estrictos

No se considera terminado si falta cualquiera de estos puntos:
- [ ] Diseño premium futurista (no plantilla genérica).
- [ ] Slot funcional con animación 3D y sonidos.
- [ ] Lluvia de billetes/monedas con física al ganar.
- [ ] Sistema de puntos recargables por bot + incremento en victoria.
- [ ] Integración Telegram Web App (`ready`, `expand`, `sendData`, `initDataUnsafe.user`).
- [ ] Arquitectura modular de CSS y JS según estructura pedida.
- [ ] Responsive completo + accesibilidad mínima.
- [ ] README útil para integración real.

---

## 18) Nivel de acabado solicitado

Quiero una entrega con calidad de producto comercial: visualmente impactante, técnicamente sólida, fácil de mantener y lista para escalar.
No simplifiques el alcance ni reemplaces efectos clave por placeholders vacíos.
