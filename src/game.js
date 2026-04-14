const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const livesEl = document.getElementById('lives');
const levelEl = document.getElementById('level');
const dashFill = document.getElementById('dash-fill');
const dashLabel = document.getElementById('dash-label');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayMsg = document.getElementById('overlay-msg');

// Game Constants
const GRAVITY = 0.07; 
const PLAYER_ACCEL = 0.7;
const FRICTION = 0.88;
const DASH_COOLDOWN = 3000;
const DASH_DURATION = 250;
const TETHER_LIFETIME = 2500;
const TRIPWIRE_LIFETIME = 1800;
const TETHER_SPEED = 12;

// State
let gameState = 'START';
let score = 0;
let lives = 3;
let currentLevel = 1;
let timeScale = 1;
let shake = 0;
let zoom = 1;
let lastTime = 0;

const keys = {};
const particles = [];
const bubbles = [];
const tethers = [];

const player = {
    x: 0,
    y: 0,
    w: 45,
    h: 55,
    vx: 0,
    isDashing: false,
    dashTimer: 0,
    dashCooldown: 0,
    invulnTimer: 0,
    color: '#fff',
    accessoryColor: '#ff1493'
};

function spawnParticles(x, y, color, count = 10, speed = 4, type = 'square') {
    for (let i = 0; i < count; i++) {
        particles.push({
            x, y,
            vx: (Math.random() - 0.5) * speed * 2,
            vy: (Math.random() - 0.5) * speed * 2,
            life: 1.0,
            decay: 0.01 + Math.random() * 0.02,
            color,
            size: 2 + Math.random() * 4,
            type: Math.random() > 0.5 ? 'heart' : 'star'
        });
    }
}

function drawHeart(ctx, x, y, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(0, -size/2, -size, -size/2, -size, 0);
    ctx.bezierCurveTo(-size, size/2, 0, size, 0, size * 1.5);
    ctx.bezierCurveTo(0, size, size, size/2, size, 0);
    ctx.bezierCurveTo(size, -size/2, 0, -size/2, 0, 0);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
}

function drawStar(ctx, x, y, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
        ctx.lineTo(Math.cos((18 + i * 72) / 180 * Math.PI) * size, 
                   -Math.sin((18 + i * 72) / 180 * Math.PI) * size);
        ctx.lineTo(Math.cos((54 + i * 72) / 180 * Math.PI) * (size/2), 
                   -Math.sin((54 + i * 72) / 180 * Math.PI) * (size/2));
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
}

class Bubble {
    constructor(x, y, size, vx, vy, color) {
        this.x = x;
        this.y = y;
        this.size = size; 
        this.radius = size * 18 + 10;
        this.vx = vx;
        this.vy = vy;
        const hue = 320 + Math.random() * 40; // Pink/Purple range
        this.color = color || `hsl(${hue}, 100%, 75%)`;
        this.bounceHeight = -Math.sqrt(size * 18) * 1.1;
    }

    update() {
        this.vy += GRAVITY * timeScale;
        this.x += this.vx * timeScale;
        this.y += this.vy * timeScale;

        if (this.x - this.radius < 0) {
            this.x = this.radius;
            this.vx *= -1;
        } else if (this.x + this.radius > canvas.width) {
            this.x = canvas.width - this.radius;
            this.vx *= -1;
        }

        if (this.y + this.radius > canvas.height) {
            this.y = canvas.height - this.radius;
            this.vy = this.bounceHeight;
        }
    }

    draw() {
        ctx.save();
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        
        // Glossy bubble effect
        const grad = ctx.createRadialGradient(this.x - this.radius/3, this.y - this.radius/3, 0, this.x, this.y, this.radius);
        grad.addColorStop(0, '#fff');
        grad.addColorStop(0.2, this.color);
        grad.addColorStop(1, '#e91e63');
        
        ctx.fillStyle = grad;
        ctx.shadowBlur = 15;
        ctx.shadowColor = this.color;
        ctx.fill();
        
        // Highlight
        ctx.beginPath();
        ctx.arc(this.x - this.radius/2, this.y - this.radius/2, this.radius/4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fill();
        
        ctx.restore();
    }

    split() {
        spawnParticles(this.x, this.y, '#fff', 15, 4);
        spawnParticles(this.x, this.y, this.color, 10, 3);
        shake = this.size * 2;
        
        if (this.size > 1) {
            bubbles.push(new Bubble(this.x - 15, this.y, this.size - 1, -1.2, -3, this.color));
            bubbles.push(new Bubble(this.x + 15, this.y, this.size - 1, 1.2, -3, this.color));
        }
        
        score += this.size * 150;
        updateUI();
    }

    shatter() {
        spawnParticles(this.x, this.y, '#fff', 25, 6);
        shake = 10;
        if (this.size > 1) {
            for (let i = 0; i < 3; i++) {
                bubbles.push(new Bubble(this.x, this.y, 1, (Math.random() - 0.5) * 6, -3, this.color));
            }
        }
        score += this.size * 300;
        updateUI();
    }
}

class Tether {
    constructor(x) {
        this.x = x;
        this.y = player.y;
        this.active = true;
        this.isStuck = false;
        this.timer = TETHER_LIFETIME;
        this.headY = player.y;
        this.speed = TETHER_SPEED;
    }

    update() {
        if (!this.isStuck) {
            this.headY -= this.speed * timeScale;
            if (this.headY <= 0) {
                this.headY = 0;
                this.isStuck = true;
                this.timer = TRIPWIRE_LIFETIME;
            }
        } else {
            this.timer -= 16 * timeScale;
            if (this.timer <= 0) this.active = false;
        }

        for (let i = bubbles.length - 1; i >= 0; i--) {
            const b = bubbles[i];
            if (this.lineCircleIntersect(this.x, this.headY, this.x, player.y, b)) {
                b.split();
                bubbles.splice(i, 1);
                this.active = false;
                break;
            }
        }
    }

    lineCircleIntersect(x1, y1, x2, y2, circle) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len === 0) return false;
        const dot = (((circle.x - x1) * (x2 - x1)) + ((circle.y - y1) * (y2 - y1))) / Math.pow(len, 2);
        const closestX = x1 + (dot * (x2 - x1));
        const closestY = y1 + (dot * (y2 - y1));
        if (dot < 0 || dot > 1) return false;
        const dist = Math.sqrt(Math.pow(closestX - circle.x, 2) + Math.pow(closestY - circle.y, 2));
        return dist < circle.radius;
    }

    draw() {
        ctx.save();
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#ff1493';
        ctx.strokeStyle = this.isStuck ? '#fff' : '#ff1493';
        ctx.lineWidth = 5;
        ctx.setLineDash(this.isStuck ? [] : [10, 5]);
        ctx.beginPath();
        ctx.moveTo(this.x, player.y);
        ctx.lineTo(this.x, this.headY);
        ctx.stroke();
        
        // Draw a heart at the tip
        drawHeart(ctx, this.x, this.headY, 8, '#fff');
        ctx.restore();
    }
}

function init() {
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', e => keys[e.code] = true);
    window.addEventListener('keyup', e => keys[e.code] = false);
    
    player.x = canvas.width / 2;
    player.y = canvas.height - player.h - 10;
    
    requestAnimationFrame(gameLoop);
}

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    player.y = canvas.height - player.h - 10;
}

function startLevel(lvl) {
    bubbles.length = 0;
    tethers.length = 0;
    particles.length = 0;
    
    const count = Math.min(lvl + 1, 5);
    for (let i = 0; i < count; i++) {
        const baseVX = (i % 2 === 0 ? 0.8 : -0.8);
        const levelScale = (lvl - 1) * 0.1;
        bubbles.push(new Bubble(
            (canvas.width / (count + 1)) * (i + 1),
            100 + (i * 40),
            Math.floor(Math.random() * 2) + 3,
            baseVX + (baseVX > 0 ? levelScale : -levelScale),
            0
        ));
    }
    
    gameState = 'PLAYING';
    overlay.classList.add('hidden');
    updateUI();
}

function updateUI() {
    scoreEl.innerText = score.toString().padStart(5, '0');
    livesEl.innerText = lives;
    levelEl.innerText = currentLevel;
}

function handleInput() {
    if (gameState !== 'PLAYING') {
        if (keys['Space']) {
            if (gameState === 'START' || gameState === 'GAMEOVER') {
                score = 0;
                lives = 3;
                currentLevel = 1;
                startLevel(currentLevel);
            } else if (gameState === 'LEVEL_CLEAR') {
                currentLevel++;
                startLevel(currentLevel);
            }
        }
        return;
    }

    if (keys['KeyA'] || keys['ArrowLeft']) player.vx -= PLAYER_ACCEL;
    if (keys['KeyD'] || keys['ArrowRight']) player.vx += PLAYER_ACCEL;

    if (keys['ShiftLeft'] && player.dashCooldown <= 0) {
        player.isDashing = true;
        player.dashTimer = DASH_DURATION;
        player.dashCooldown = DASH_COOLDOWN;
        player.invulnTimer = 600;
        player.vx *= 3.5;
        spawnParticles(player.x + player.w/2, player.y + player.h/2, '#fff', 15, 2);
    }

    if (keys['Space'] && tethers.length < 1) {
        tethers.push(new Tether(player.x + player.w / 2));
    }
}

function gameLoop(time) {
    const dt = time - lastTime;
    lastTime = time;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackground();

    ctx.save();
    if (shake > 0) {
        ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
        shake *= 0.9;
    }
    if (zoom > 1) {
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.scale(zoom, zoom);
        ctx.translate(-canvas.width / 2, -canvas.height / 2);
        zoom -= 0.005;
    }

    handleInput();

    if (gameState === 'PLAYING') {
        updatePhysics();
    }

    drawEntities();
    ctx.restore();

    requestAnimationFrame(gameLoop);
}

function updatePhysics() {
    player.x += player.vx * timeScale;
    player.vx *= FRICTION;
    
    if (player.x < 0) player.x = 0;
    if (player.x + player.w > canvas.width) player.x = canvas.width - player.w;

    if (player.dashCooldown > 0) player.dashCooldown -= 16 * timeScale;
    if (player.dashTimer > 0) {
        player.dashTimer -= 16 * timeScale;
        if (player.dashTimer <= 0) player.isDashing = false;
    }
    if (player.invulnTimer > 0) player.invulnTimer -= 16 * timeScale;

    const dashPerc = Math.max(0, 1 - (player.dashCooldown / DASH_COOLDOWN));
    dashFill.style.width = (dashPerc * 100) + '%';
    dashLabel.innerText = dashPerc >= 1 ? 'FABULOUS' : 'RECHARGING...';

    bubbles.forEach(b => b.update());

    for (let i = tethers.length - 1; i >= 0; i--) {
        tethers[i].update();
        if (!tethers[i].active) tethers.splice(i, 1);
    }

    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * timeScale;
        p.y += p.vy * timeScale;
        p.life -= p.decay * timeScale;
        if (p.life <= 0) particles.splice(i, 1);
    }

    bubbles.forEach((b, idx) => {
        const dx = (player.x + player.w / 2) - b.x;
        const dy = (player.y + player.h / 2) - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < b.radius + 15) {
            if (player.isDashing) {
                b.shatter();
                bubbles.splice(idx, 1);
            } else if (player.invulnTimer <= 0) {
                playerHit();
            }
        }
    });

    if (bubbles.length === 0 && gameState === 'PLAYING') {
        gameState = 'LEVEL_CLEAR';
        timeScale = 0.4;
        zoom = 1.05;
        setTimeout(() => {
            timeScale = 1;
            overlay.classList.remove('hidden');
            overlayTitle.innerText = "YOU'RE STUNNING!";
            overlayMsg.innerText = "STAGE " + currentLevel + " COMPLETE";
        }, 1200);
    }
}

function playerHit() {
    lives--;
    shake = 20;
    spawnParticles(player.x + player.w / 2, player.y + player.h / 2, '#ff1493', 40, 10);
    updateUI();
    
    if (lives <= 0) {
        gameState = 'GAMEOVER';
        overlay.classList.remove('hidden');
        overlayTitle.innerText = "DREAM OVER";
        overlayMsg.innerText = "STILL FABULOUS! RETRY? Stage " + currentLevel;
    } else {
        player.invulnTimer = 2000;
        player.x = canvas.width / 2;
    }
}

function drawBackground() {
    // Subtle sparkle pattern
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    const step = 100;
    for (let x = 0; x < canvas.width; x += step) {
        for (let y = 0; y < canvas.height; y += step) {
            if ((x + y) % 200 === 0) {
                ctx.beginPath();
                ctx.arc(x + Math.sin(Date.now()/1000 + x)*10, y + Math.cos(Date.now()/1000 + y)*10, 2, 0, Math.PI*2);
                ctx.fill();
            }
        }
    }
}

function drawEntities() {
    particles.forEach(p => {
        ctx.globalAlpha = p.life;
        if (p.type === 'heart') {
            drawHeart(ctx, p.x, p.y, p.size, p.color);
        } else {
            drawStar(ctx, p.x, p.y, p.size, p.color);
        }
    });
    ctx.globalAlpha = 1;

    tethers.forEach(t => t.draw());

    ctx.save();
    if (player.invulnTimer > 0 && Math.floor(Date.now() / 100) % 2 === 0) {
        ctx.globalAlpha = 0.4;
    }
    
    if (player.isDashing) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.fillRect(player.x - player.vx * 1.2, player.y, player.w, player.h);
    }

    // Draw Barbie-style player (Stylized silhouette/dress shape)
    ctx.shadowBlur = 15;
    ctx.shadowColor = '#ff1493';
    
    // Dress
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(player.x + player.w/2, player.y);
    ctx.lineTo(player.x, player.y + player.h);
    ctx.lineTo(player.x + player.w, player.y + player.h);
    ctx.closePath();
    ctx.fill();
    
    // Heart on dress
    drawHeart(ctx, player.x + player.w/2, player.y + player.h/2, 6, '#ff1493');
    
    // Crown/Hair
    ctx.fillStyle = '#ffd700'; // Gold crown
    ctx.fillRect(player.x + player.w/2 - 10, player.y - 5, 20, 5);
    ctx.beginPath();
    ctx.moveTo(player.x + player.w/2 - 10, player.y - 5);
    ctx.lineTo(player.x + player.w/2 - 5, player.y - 12);
    ctx.lineTo(player.x + player.w/2, player.y - 5);
    ctx.lineTo(player.x + player.w/2 + 5, player.y - 12);
    ctx.lineTo(player.x + player.w/2 + 10, player.y - 5);
    ctx.fill();

    ctx.restore();

    bubbles.forEach(b => b.draw());
}

init();