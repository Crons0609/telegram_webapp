(() => {
  "use strict";

  const canvas = document.getElementById("particles");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  let particles = [];

  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  resize();
  window.addEventListener("resize", resize);

  function spawnBurst(x = canvas.width / 2, y = canvas.height / 2, amount = 80) {
    const colors = ["#FFD700", "#FF0000", "#00FFFF", "#800080", "#ffffff"];
    for (let i = 0; i < amount; i++) {
      particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 8,
        vy: (Math.random() - 0.5) * 8 - 2,
        life: 80 + Math.random() * 30,
        color: colors[(Math.random() * colors.length) | 0],
        size: Math.random() * 3 + 1,
      });
    }
  }

  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles = particles.filter((p) => p.life > 0);

    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.06;
      p.life -= 1;
      ctx.globalAlpha = Math.max(p.life / 100, 0);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    requestAnimationFrame(tick);
  }
  tick();

  window.CasinoFX = {
    confetti: () => spawnBurst(window.innerWidth / 2, window.innerHeight * 0.38, 120),
  };
})();
