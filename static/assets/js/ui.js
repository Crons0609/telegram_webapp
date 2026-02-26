(() => {
  "use strict";

  const tg = window.Telegram?.WebApp;
  if (!tg) return;

  tg.ready();
  tg.expand();
  tg.setHeaderColor("#1a0935");
  tg.setBackgroundColor("#06020d");
})();
