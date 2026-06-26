// Premium 交互效果 — 磁性按钮 + 粒子背景
(function() {

// ── 磁性按钮 ──
function initMagneticButtons() {
  document.querySelectorAll('.magnetic').forEach(function(el) {
    el.addEventListener('mousemove', function(e) {
      var rect = el.getBoundingClientRect();
      var x = e.clientX - rect.left - rect.width / 2;
      var y = e.clientY - rect.top - rect.height / 2;
      var strength = 8;
      el.style.transform =
        'translate(' + (x / strength).toFixed(1) + 'px, ' + (y / strength).toFixed(1) + 'px) scale(1.03)';
    });
    el.addEventListener('mouseleave', function() {
      el.style.transform = '';
    });
    el.addEventListener('mousedown', function() {
      el.style.transform = 'scale(0.97)';
    });
    el.addEventListener('mouseup', function() {
      el.style.transform = 'scale(1.03)';
    });
  });
}

// ── 粒子背景 (Canvas 2D, 无需 Three.js 依赖) ──
function initParticleBackground() {
  var canvas = document.getElementById('particle-bg');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'particle-bg';
    document.body.prepend(canvas);
  }

  var ctx = canvas.getContext('2d');
  var particles = [];
  var PARTICLE_COUNT = 50;
  var mouseX = -1000, mouseY = -1000;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  function isDark() {
    return document.documentElement.classList.contains('dark');
  }

  function createParticles() {
    particles = [];
    for (var i = 0; i < PARTICLE_COUNT; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        r: Math.random() * 2 + 0.5,
        opacity: Math.random() * 0.4 + 0.1,
      });
    }
  }
  createParticles();

  document.addEventListener('mousemove', function(e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
  });

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    var color = isDark() ? '255, 255, 255' : '24, 32, 47';
    var lineColor = isDark() ? 'rgba(255,255,255,0.04)' : 'rgba(24,32,47,0.04)';

    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];

      // 鼠标吸引
      var dx = mouseX - p.x;
      var dy = mouseY - p.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 200) {
        var force = (200 - dist) / 200 * 0.02;
        p.vx += dx * force * 0.01;
        p.vy += dy * force * 0.01;
      }

      // 阻尼
      p.vx *= 0.99;
      p.vy *= 0.99;

      p.x += p.vx;
      p.y += p.vy;

      // 边界回弹
      if (p.x < 0) { p.x = 0; p.vx *= -1; }
      if (p.x > canvas.width) { p.x = canvas.width; p.vx *= -1; }
      if (p.y < 0) { p.y = 0; p.vy *= -1; }
      if (p.y > canvas.height) { p.y = canvas.height; p.vy *= -1; }

      // 画粒子
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + color + ',' + p.opacity + ')';
      ctx.fill();

      // 连线
      for (var j = i + 1; j < particles.length; j++) {
        var p2 = particles[j];
        var ddx = p.x - p2.x;
        var ddy = p.y - p2.y;
        var ddist = Math.sqrt(ddx * ddx + ddy * ddy);
        if (ddist < 120) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.strokeStyle = lineColor;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }

    if (animating) requestAnimationFrame(draw);
  }

  // 页面不可见时暂停动画，节省 CPU
  var animating = true;
  document.addEventListener('visibilitychange', function() {
    animating = !document.hidden;
    if (animating) draw();
  });

  draw();
}

// ── 初始化 ──
document.addEventListener('DOMContentLoaded', function() {
  initMagneticButtons();
  initParticleBackground();
});

// 对动态添加的元素也启用磁性效果
if (window.MutationObserver) {
  new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var added = mutations[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        if (added[j].nodeType === 1) {
          if (added[j].classList && added[j].classList.contains('magnetic')) {
            initMagneticButtons();
            return;
          }
        }
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}

})();
