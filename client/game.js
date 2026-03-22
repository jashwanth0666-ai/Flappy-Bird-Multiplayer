const GAME_CONFIG = {
  width: 420,
  height: 640,
  groundHeight: 96,
  gravity: 1450,
  jumpVelocity: -380,
  networkUpdateMs: 80,
  bird: {
    x: 120,
    y: 280,
    radius: 18,
    width: 38,
    height: 28,
  },
};

const BIRD_COLORS = [
  "#ffd166",
  "#7bdff2",
  "#f28482",
  "#84a59d",
  "#c77dff",
  "#90be6d",
];

const THEME_SKINS = {
  light: {
    skyTop: "#7fd4ff",
    skyBottom: "#f0fbff",
    glow: "rgba(255, 213, 117, 0.55)",
    mountain: "#bfd9ca",
    mountainBack: "#dceee6",
    grass: "#8dcc62",
    ground: "#d6b06a",
    groundStripe: "#bf9550",
    cloud: "rgba(255,255,255,0.78)",
  },
  dark: {
    skyTop: "#10233f",
    skyBottom: "#06111f",
    glow: "rgba(66, 210, 255, 0.28)",
    mountain: "#18344c",
    mountainBack: "#11273c",
    grass: "#3b8c63",
    ground: "#7f6641",
    groundStripe: "#6e5534",
    cloud: "rgba(189,220,255,0.18)",
  },
};

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getBirdPalette(key, isLocal = false) {
  if (isLocal) {
    return {
      body: "#ffd166",
      wing: "#ef476f",
      beak: "#f77f00",
    };
  }

  const base = BIRD_COLORS[hashString(key) % BIRD_COLORS.length];
  return {
    body: base,
    wing: "rgba(255,255,255,0.45)",
    beak: "#163041",
  };
}

function getBirdRotation(velocity) {
  return clamp(velocity / 420, -0.7, 1.1);
}

class SoundManager {
  constructor(ui) {
    this.ui = ui;
    this.context = null;
    this.masterGain = null;
    this.muted = false;
    this.gameOverAudio = new Audio("assets/game-over.mp3");
    this.gameOverAudio.preload = "auto";
    this.syncButton();
  }

  ensureContext() {
    if (this.context) {
      if (this.context.state === "suspended") {
        this.context.resume().catch(() => {});
      }
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }

    this.context = new AudioContextClass();
    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = this.muted ? 0 : 0.08;
    this.masterGain.connect(this.context.destination);
  }

  syncButton() {
    this.ui.muteToggleButton.textContent = this.muted ? "Unmute" : "Mute";
  }

  toggleMute() {
    this.muted = !this.muted;
    this.syncButton();
    this.ensureContext();
    if (this.masterGain) {
      this.masterGain.gain.value = this.muted ? 0 : 0.08;
    }
    this.gameOverAudio.muted = this.muted;
  }

  playTone({ frequency, duration, type = "sine", gain = 0.22, endFrequency = frequency }) {
    this.ensureContext();
    if (!this.context || !this.masterGain || this.muted) {
      return;
    }

    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    const now = this.context.currentTime;

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), now + duration);

    envelope.gain.setValueAtTime(0.001, now);
    envelope.gain.exponentialRampToValueAtTime(gain, now + 0.01);
    envelope.gain.exponentialRampToValueAtTime(0.001, now + duration);

    oscillator.connect(envelope);
    envelope.connect(this.masterGain);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  playJump() {
    this.playTone({ frequency: 460, endFrequency: 680, duration: 0.12, type: "triangle", gain: 0.18 });
  }

  playScore() {
    this.playTone({ frequency: 720, endFrequency: 940, duration: 0.14, type: "sine", gain: 0.15 });
  }

  playGameOver() {
    if (this.muted) {
      return;
    }

    this.gameOverAudio.currentTime = 0;
    this.gameOverAudio.play().catch(() => {});
  }
}

class ParticleSystem {
  constructor() {
    this.items = [];
  }

  emitScoreBurst(x, y) {
    for (let index = 0; index < 12; index += 1) {
      const angle = (Math.PI * 2 * index) / 12;
      const speed = 55 + Math.random() * 65;
      const life = 0.5 + Math.random() * 0.22;
      this.items.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 12,
        life,
        maxLife: life,
        size: 3 + Math.random() * 4,
        color: index % 2 === 0 ? "#ffe38b" : "#ffffff",
      });
    }
  }

  update(deltaTime) {
    this.items = this.items
      .map((particle) => ({
        ...particle,
        x: particle.x + particle.vx * deltaTime,
        y: particle.y + particle.vy * deltaTime,
        vy: particle.vy + 180 * deltaTime,
        life: particle.life - deltaTime,
      }))
      .filter((particle) => particle.life > 0);
  }

  draw(ctx) {
    this.items.forEach((particle) => {
      const alpha = particle.life / particle.maxLife;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size * alpha, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }
}

class Bird {
  constructor(config) {
    this.config = config;
    this.reset();
  }

  reset() {
    this.x = this.config.x;
    this.y = this.config.y;
    this.velocityY = 0;
    this.rotation = 0;
  }

  flap(jumpVelocity) {
    this.velocityY = jumpVelocity;
  }

  update(deltaTime, gravity) {
    this.velocityY += gravity * deltaTime;
    this.y += this.velocityY * deltaTime;
    this.rotation = getBirdRotation(this.velocityY);
  }

  getBounds() {
    return {
      left: this.x - this.config.width / 2,
      right: this.x + this.config.width / 2,
      top: this.y - this.config.height / 2,
      bottom: this.y + this.config.height / 2,
    };
  }

  draw(ctx, options = {}) {
    drawBirdSprite(ctx, {
      x: this.x,
      y: this.y,
      rotation: this.rotation,
      width: this.config.width,
      height: this.config.height,
      palette: options.palette,
      label: options.label,
      ghost: options.ghost,
    });
  }
}

function drawBirdSprite(ctx, options) {
  const {
    x,
    y,
    rotation = 0,
    width,
    height,
    palette = getBirdPalette("local", true),
    label = "",
    ghost = false,
  } = options;

  if (label) {
    ctx.save();
    ctx.font = "700 13px Poppins, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = ghost ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.88)";
    ctx.strokeStyle = "rgba(22,48,65,0.55)";
    ctx.lineWidth = 4;
    ctx.strokeText(label, x, y - height);
    ctx.fillText(label, x, y - height);
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = ghost ? 0.45 : 1;
  ctx.translate(x, y);
  ctx.rotate(rotation);

  ctx.fillStyle = palette.body;
  ctx.beginPath();
  ctx.ellipse(0, 0, width / 2, height / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = palette.beak;
  ctx.beginPath();
  ctx.moveTo(10, -3);
  ctx.lineTo(28, 3);
  ctx.lineTo(10, 10);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(7, -6, 7, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#102533";
  ctx.beginPath();
  ctx.arc(9, -6, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = palette.wing;
  ctx.beginPath();
  ctx.ellipse(-7, 11, 9, 4, 0.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

class PipeStore {
  constructor(config) {
    this.config = config;
    this.pipes = new Map();
  }

  reset() {
    this.pipes.clear();
  }

  sync(snapshot) {
    const nextIds = new Set();

    (snapshot || []).forEach((pipe) => {
      nextIds.add(pipe.id);
      const existing = this.pipes.get(pipe.id);
      const normalized = {
        id: pipe.id,
        x: Number.isFinite(pipe.x) ? pipe.x : this.config.width,
        gapY: Number.isFinite(pipe.gapY) ? pipe.gapY : 160,
        gapHeight: Number.isFinite(pipe.gapHeight) ? pipe.gapHeight : 160,
        speed: Number.isFinite(pipe.speed) ? pipe.speed : 0,
        width: Number.isFinite(pipe.width) ? pipe.width : 74,
      };

      if (!existing) {
        this.pipes.set(pipe.id, {
          ...normalized,
          renderX: normalized.x,
        });
        return;
      }

      Object.assign(existing, normalized);
    });

    Array.from(this.pipes.keys()).forEach((id) => {
      if (!nextIds.has(id)) {
        this.pipes.delete(id);
      }
    });
  }

  updateInterpolation(deltaTime) {
    const smoothing = Math.min(1, deltaTime * 12);
    this.pipes.forEach((pipe) => {
      pipe.renderX = lerp(pipe.renderX, pipe.x, smoothing);
    });
  }

  draw(ctx) {
    const groundY = this.config.height - this.config.groundHeight;

    this.pipes.forEach((pipe) => {
      const capHeight = 28;
      const topHeight = pipe.gapY;
      const bottomY = pipe.gapY + pipe.gapHeight;
      const bottomHeight = groundY - bottomY;

      const gradient = ctx.createLinearGradient(pipe.renderX, 0, pipe.renderX + pipe.width, 0);
      gradient.addColorStop(0, "#2c9961");
      gradient.addColorStop(1, "#55cf7d");
      ctx.fillStyle = gradient;
      ctx.fillRect(pipe.renderX, 0, pipe.width, topHeight);
      ctx.fillRect(pipe.renderX, bottomY, pipe.width, bottomHeight);

      ctx.fillStyle = "#22724c";
      ctx.fillRect(pipe.renderX - 6, topHeight - capHeight, pipe.width + 12, capHeight);
      ctx.fillRect(pipe.renderX - 6, bottomY, pipe.width + 12, capHeight);

      ctx.fillStyle = "rgba(255,255,255,0.16)";
      ctx.fillRect(pipe.renderX + 10, 0, 10, topHeight);
      ctx.fillRect(pipe.renderX + 10, bottomY, 10, bottomHeight);
    });
  }

  getCollisionCandidates() {
    return Array.from(this.pipes.values());
  }

  getSortedPipes() {
    return Array.from(this.pipes.values()).sort((left, right) => left.x - right.x);
  }

  toSerializable() {
    return this.getSortedPipes().map((pipe) => ({
      id: pipe.id,
      x: Number(pipe.x.toFixed(2)),
      gapTop: Number(pipe.gapY.toFixed(2)),
      gapBottom: Number((pipe.gapY + pipe.gapHeight).toFixed(2)),
      speed: pipe.speed,
      width: pipe.width,
    }));
  }
}

class RemotePlayerStore {
  constructor(config) {
    this.config = config;
    this.players = new Map();
  }

  reset() {
    this.players.clear();
  }

  sync(snapshot, localSocketId) {
    const nextIds = new Set();

    Object.values(snapshot || {}).forEach((player) => {
      if (!player || player.id === localSocketId) {
        return;
      }

      nextIds.add(player.id);
      const existing = this.players.get(player.id);
      const nextState = {
        id: player.id,
        name: player.name || "Player",
        x: Number.isFinite(player.x) ? player.x : this.config.bird.x,
        y: Number.isFinite(player.y) ? player.y : this.config.bird.y,
        velocity: Number.isFinite(player.velocity) ? player.velocity : 0,
        score: Number.isFinite(player.score) ? player.score : 0,
        isAlive: Boolean(player.isAlive),
        rotation: getBirdRotation(Number.isFinite(player.velocity) ? player.velocity : 0),
      };

      if (!existing) {
        this.players.set(player.id, {
          ...nextState,
          renderX: nextState.x,
          renderY: nextState.y,
          renderRotation: nextState.rotation,
        });
        return;
      }

      Object.assign(existing, nextState);
    });

    Array.from(this.players.keys()).forEach((id) => {
      if (!nextIds.has(id)) {
        this.players.delete(id);
      }
    });
  }

  updateInterpolation(deltaTime) {
    const smoothing = Math.min(1, deltaTime * 10);
    this.players.forEach((player) => {
      player.renderX = lerp(player.renderX, player.x, smoothing);
      player.renderY = lerp(player.renderY, player.y, smoothing);
      player.renderRotation = lerp(player.renderRotation, player.rotation, smoothing);
    });
  }

  draw(ctx) {
    this.players.forEach((player) => {
      drawBirdSprite(ctx, {
        x: player.renderX,
        y: player.renderY,
        rotation: player.renderRotation,
        width: this.config.bird.width,
        height: this.config.bird.height,
        palette: getBirdPalette(player.id),
        label: player.name,
        ghost: !player.isAlive,
      });
    });
  }

  toSerializable() {
    return Array.from(this.players.values()).map((player) => ({
      id: player.id,
      name: player.name,
      x: Number(player.x.toFixed(2)),
      y: Number(player.y.toFixed(2)),
      velocity: Number(player.velocity.toFixed(2)),
      score: player.score,
      isAlive: player.isAlive,
    }));
  }
}

class NetworkClient {
  constructor(game, serverUrl) {
    this.game = game;
    this.serverUrl = serverUrl;
    this.socket = null;
    this.localSocketId = "";
    this.lastSentAt = 0;
  }

  connect() {
    if (typeof io === "undefined") {
      return;
    }

    this.socket = io(this.serverUrl, {
      transports: ["websocket", "polling"],
    });

    this.socket.on("connect", () => {
      this.localSocketId = this.socket.id;
      this.game.setConnectionStatus("Online");
      this.game.setRoomMessage("Connected. Create or join a room.", false);
    });

    this.socket.on("disconnect", () => {
      this.localSocketId = "";
      this.game.setConnectionStatus("Offline");
      this.game.handleRoomLeft("Disconnected from server.");
    });

    this.socket.on("roomPlayersUpdate", (payload) => {
      this.handleRoomPlayersUpdate(payload);
    });

    this.socket.on("roomPipesUpdate", (payload) => {
      this.handleRoomPipesUpdate(payload);
    });
  }

  createRoom() {
    this.game.sound.ensureContext();
    if (!this.socket || !this.socket.connected) {
      this.game.setRoomMessage("Server connection is offline.", true);
      return;
    }

    this.socket.emit("createRoom", (response) => {
      this.handleRoomJoinResponse(response, "Room created.");
    });
  }

  joinRoom(roomId) {
    this.game.sound.ensureContext();
    if (!this.socket || !this.socket.connected) {
      this.game.setRoomMessage("Server connection is offline.", true);
      return;
    }

    this.socket.emit("joinRoom", { roomId }, (response) => {
      this.handleRoomJoinResponse(response, `Joined room ${String(roomId || "").trim().toUpperCase()}.`);
    });
  }

  handleRoomJoinResponse(response, successMessage) {
    if (!response?.ok) {
      this.game.setRoomMessage(response?.error || "Unable to join room.", true);
      return;
    }

    this.game.handleRoomJoined(response.roomId, successMessage);
  }

  handleRoomPlayersUpdate(payload) {
    if (!payload?.roomId || payload.roomId !== this.game.currentRoomId) {
      return;
    }

    const localId = this.localSocketId || (this.socket ? this.socket.id : "");
    this.game.remotePlayers.sync(payload.players || {}, localId);
    this.game.updateScoreboard(payload.players || {});
  }

  handleRoomPipesUpdate(payload) {
    if (!payload?.roomId || payload.roomId !== this.game.currentRoomId) {
      return;
    }

    this.game.pipeStore.sync(payload.pipes || []);
  }

  sendPlayerUpdate(force = false) {
    if (!this.socket || !this.socket.connected || !this.game.currentRoomId) {
      return;
    }

    const now = performance.now();
    if (!force && now - this.lastSentAt < this.game.config.networkUpdateMs) {
      return;
    }

    this.lastSentAt = now;
    const bird = this.game.primaryBird;
    this.socket.emit("playerUpdate", {
      name: this.game.playerProfile.name,
      x: bird.x,
      y: bird.y,
      velocity: bird.velocityY,
      score: this.game.score,
      isAlive: this.game.mode === "running",
    });
  }
}

class FlappyGame {
  constructor(canvas, ui) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.ui = ui;
    this.config = GAME_CONFIG;
    this.birds = [new Bird(this.config.bird)];
    this.pipeStore = new PipeStore(this.config);
    this.remotePlayers = new RemotePlayerStore(this.config);
    this.particles = new ParticleSystem();
    this.sound = new SoundManager(ui);
    this.network = new NetworkClient(this, "http://localhost:3000");
    this.mode = "menu";
    this.score = 0;
    this.scoreboardPlayers = {};
    this.passedPipeIds = new Set();
    this.currentRoomId = "";
    this.theme = document.body.dataset.theme || "light";
    this.screenShake = 0;
    this.backgroundDrift = 0;
    this.playerProfile = {
      name: "Player",
      hasStartedSession: false,
    };
    this.lastFrameTime = 0;
    this.boundLoop = (time) => this.loop(time);

    this.bindEvents();
    this.network.connect();
    this.setTheme(this.theme);
    this.setRoomId("");
    this.setRoomMessage("Create a room or join an existing one to begin.", false);
    this.resetLocalRound("menu");
    this.render();
    requestAnimationFrame(this.boundLoop);
  }

  get primaryBird() {
    return this.birds[0];
  }

  bindEvents() {
    window.addEventListener("keydown", (event) => {
      if (event.code === "Space") {
        if (this.mode !== "running" && this.mode !== "gameover") {
          return;
        }

        event.preventDefault();
        this.handleInput();
      }
    });

    this.canvas.addEventListener("pointerdown", (event) => {
      if (event.button && event.button !== 0) {
        return;
      }

      this.handleInput();
    });
    this.ui.createRoomButton.addEventListener("click", () => this.network.createRoom());
    this.ui.joinRoomButton.addEventListener("click", () => this.joinRoomFromInput());
    this.ui.startButton.addEventListener("click", () => this.startNewSession());
    this.ui.restartButton.addEventListener("click", () => this.restartRound());
    this.ui.themeToggleButton.addEventListener("click", () => this.toggleTheme());
    this.ui.muteToggleButton.addEventListener("click", () => this.sound.toggleMute());
    this.ui.playerNameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.startNewSession();
      }
    });
    this.ui.joinRoomInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.joinRoomFromInput();
      }
    });
  }

  resolvePlayerName(value) {
    const trimmed = value.trim();
    return trimmed || "Player";
  }

  setConnectionStatus(value) {
    this.ui.connectionValue.textContent = value;
  }

  setTheme(theme) {
    this.theme = theme === "dark" ? "dark" : "light";
    document.body.dataset.theme = this.theme;
    this.ui.themeToggleButton.textContent = this.theme === "dark" ? "Light Mode" : "Dark Mode";
  }

  toggleTheme() {
    this.setTheme(this.theme === "dark" ? "light" : "dark");
  }

  setRoomId(roomId) {
    this.currentRoomId = roomId;
    this.ui.roomValue.textContent = roomId || "None";
    this.ui.joinRoomInput.value = roomId || "";
    this.ui.startButton.disabled = !roomId;
  }

  setRoomMessage(message, isError = false) {
    this.ui.roomMessage.textContent = message;
    this.ui.roomMessage.classList.toggle("error", Boolean(isError));
  }

  clearRoomState() {
    this.pipeStore.reset();
    this.remotePlayers.reset();
    this.scoreboardPlayers = {};
    this.updateScoreboard({});
    this.passedPipeIds = new Set();
    this.particles.items = [];
  }

  handleRoomJoined(roomId, message) {
    this.setRoomId(roomId);
    this.clearRoomState();
    this.resetLocalRound("menu");
    this.setRoomMessage(message || `Joined room ${roomId}.`, false);
  }

  handleRoomLeft(message) {
    this.setRoomId("");
    this.clearRoomState();
    this.resetLocalRound("menu");
    this.setRoomMessage(message || "Create a room or join an existing one to begin.", true);
  }

  joinRoomFromInput() {
    const roomId = String(this.ui.joinRoomInput.value || "").trim().toUpperCase();
    if (!roomId) {
      this.setRoomMessage("Enter a room ID first.", true);
      return;
    }

    this.ui.joinRoomInput.value = roomId;
    this.network.joinRoom(roomId);
  }

  seedPassedPipeIds() {
    this.passedPipeIds = new Set(
      this.pipeStore
        .getSortedPipes()
        .filter((pipe) => pipe.x + pipe.width < this.primaryBird.x)
        .map((pipe) => pipe.id)
    );
  }

  resetLocalRound(nextMode = "menu") {
    this.mode = nextMode;
    this.score = 0;
    this.screenShake = 0;
    this.primaryBird.reset();
    this.syncScore();
    this.syncPlayerName();
    this.seedPassedPipeIds();

    if (nextMode === "menu") {
      this.showStartScreen();
      return;
    }

    this.hideOverlay();
    this.network.sendPlayerUpdate(true);
  }

  startNewSession() {
    this.sound.ensureContext();
    if (!this.currentRoomId) {
      this.setRoomMessage("Create a room or join one before starting.", true);
      return;
    }

    this.playerProfile.name = this.resolvePlayerName(this.ui.playerNameInput.value);
    this.playerProfile.hasStartedSession = true;
    this.ui.playerNameInput.value = this.playerProfile.name;
    this.resetLocalRound("running");
    this.primaryBird.flap(this.config.jumpVelocity);
    this.sound.playJump();
    this.network.sendPlayerUpdate(true);
    this.updateScoreboard(this.scoreboardPlayers);
  }

  handleInput() {
    this.sound.ensureContext();
    if (this.mode === "running") {
      this.primaryBird.flap(this.config.jumpVelocity);
      this.sound.playJump();
      this.network.sendPlayerUpdate(true);
      return;
    }

    if (this.mode === "gameover") {
      this.restartRound();
    }
  }

  restartRound() {
    if (!this.playerProfile.hasStartedSession) {
      this.showStartScreen();
      return;
    }

    if (!this.currentRoomId) {
      this.setRoomMessage("Rejoin a room before restarting.", true);
      this.showStartScreen();
      return;
    }

    this.resetLocalRound("running");
    this.primaryBird.flap(this.config.jumpVelocity);
    this.sound.playJump();
    this.network.sendPlayerUpdate(true);
  }

  update(deltaTime) {
    this.backgroundDrift += deltaTime * 18;
    this.screenShake = Math.max(0, this.screenShake - deltaTime * 24);
    this.pipeStore.updateInterpolation(deltaTime);
    this.remotePlayers.updateInterpolation(deltaTime);
    this.particles.update(deltaTime);

    if (this.mode !== "running") {
      return;
    }

    this.primaryBird.update(deltaTime, this.config.gravity);
    this.updateScore();
    this.network.sendPlayerUpdate();

    if (this.hasCollision()) {
      this.endGame();
    }
  }

  updateScore() {
    this.pipeStore.getSortedPipes().forEach((pipe) => {
      if (this.passedPipeIds.has(pipe.id)) {
        return;
      }

      if (pipe.x + pipe.width < this.primaryBird.x) {
        this.passedPipeIds.add(pipe.id);
        this.score += 1;
        this.syncScore();
        this.particles.emitScoreBurst(this.primaryBird.x + 28, this.primaryBird.y);
        this.sound.playScore();
        this.network.sendPlayerUpdate(true);
      }
    });
  }

  hasCollision() {
    const bounds = this.primaryBird.getBounds();
    const groundY = this.config.height - this.config.groundHeight;

    if (bounds.top <= 0 || bounds.bottom >= groundY) {
      return true;
    }

    return this.pipeStore.getCollisionCandidates().some((pipe) => {
      const overlapsHorizontally = bounds.right > pipe.x && bounds.left < pipe.x + pipe.width;
      if (!overlapsHorizontally) {
        return false;
      }

      const gapTop = pipe.gapY;
      const gapBottom = pipe.gapY + pipe.gapHeight;
      return bounds.top < gapTop || bounds.bottom > gapBottom;
    });
  }

  endGame() {
    this.mode = "gameover";
    this.screenShake = Math.max(this.screenShake, 9);
    this.sound.playGameOver();
    this.network.sendPlayerUpdate(true);
    this.showGameOverScreen();
  }

  syncScore() {
    this.ui.scoreValue.textContent = String(this.score);
  }

  syncPlayerName() {
    this.ui.playerNameValue.textContent = this.playerProfile.name;
  }

  updateScoreboard(players) {
    this.scoreboardPlayers = players;
    const localId = this.network.localSocketId;
    const roster = Object.values(players || {})
      .map((player) => ({
        id: player.id,
        name: player.name || "Player",
        score: Number.isFinite(player.score) ? player.score : 0,
        isAlive: Boolean(player.isAlive),
      }))
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return left.name.localeCompare(right.name);
      });

    if (roster.length === 0) {
      this.ui.scoreboardList.innerHTML = '<p class="scoreboard-empty">Waiting for pilots...</p>';
      return;
    }

    this.ui.scoreboardList.innerHTML = roster
      .map((player) => {
        const selfMarker = player.id === localId ? " (You)" : "";
        const status = player.isAlive ? "" : " KO";
        return `
          <p class="scoreboard-row">
            <span class="scoreboard-name">${escapeHtml(player.name)}${selfMarker}${status}</span>
            <span class="scoreboard-score">${player.score}</span>
          </p>
        `;
      })
      .join("");
  }

  showStartScreen() {
    this.ui.overlayTitle.textContent = "Flappy Bird Multiplayer";
    this.ui.overlayMessage.textContent = "Enter your pilot name, choose a room, then start the round.";
    this.ui.startScreen.classList.remove("hidden");
    this.ui.gameOverScreen.classList.add("hidden");
    this.showOverlay();
    this.ui.playerNameInput.focus();
  }

  showGameOverScreen() {
    this.ui.gameOverPlayer.textContent = `Player: ${this.playerProfile.name}`;
    this.ui.gameOverScore.textContent = `Score: ${this.score}`;
    this.ui.startScreen.classList.add("hidden");
    this.ui.gameOverScreen.classList.remove("hidden");
    this.showOverlay();
  }

  showOverlay() {
    this.ui.overlay.classList.remove("hidden");
  }

  hideOverlay() {
    this.ui.overlay.classList.add("hidden");
  }

  loop(timestamp) {
    if (!this.lastFrameTime) {
      this.lastFrameTime = timestamp;
    }

    const deltaTime = Math.min((timestamp - this.lastFrameTime) / 1000, 1 / 30);
    this.lastFrameTime = timestamp;

    this.update(deltaTime);
    this.render();
    requestAnimationFrame(this.boundLoop);
  }

  renderBackground() {
    const { ctx, config } = this;
    const skin = THEME_SKINS[this.theme];
    const groundY = config.height - config.groundHeight;
    const drift = this.backgroundDrift;

    const skyGradient = ctx.createLinearGradient(0, 0, 0, groundY);
    skyGradient.addColorStop(0, skin.skyTop);
    skyGradient.addColorStop(1, skin.skyBottom);
    ctx.fillStyle = skyGradient;
    ctx.fillRect(0, 0, config.width, groundY);

    ctx.fillStyle = skin.glow;
    ctx.beginPath();
    ctx.arc(92, 96, 52, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = skin.mountainBack;
    ctx.beginPath();
    ctx.moveTo(0, groundY - 42);
    ctx.quadraticCurveTo(70, groundY - 122, 150, groundY - 62);
    ctx.quadraticCurveTo(220, groundY - 12, 320, groundY - 82);
    ctx.quadraticCurveTo(360, groundY - 110, config.width, groundY - 40);
    ctx.lineTo(config.width, groundY);
    ctx.lineTo(0, groundY);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = skin.mountain;
    ctx.beginPath();
    ctx.moveTo(0, groundY - 12);
    ctx.quadraticCurveTo(90, groundY - 92, 180, groundY - 24);
    ctx.quadraticCurveTo(260, groundY + 22, 360, groundY - 52);
    ctx.quadraticCurveTo(390, groundY - 72, config.width, groundY - 20);
    ctx.lineTo(config.width, groundY);
    ctx.lineTo(0, groundY);
    ctx.closePath();
    ctx.fill();

    this.drawCloud(70 + (drift * 0.8) % 480, 110, 44, skin.cloud);
    this.drawCloud(302 + (drift * 0.45) % 520, 168, 54, skin.cloud);
    this.drawCloud(214 + (drift * 0.25) % 580, 78, 28, skin.cloud);

    ctx.fillStyle = skin.grass;
    ctx.fillRect(0, groundY - 18, config.width, 18);
    ctx.fillStyle = skin.ground;
    ctx.fillRect(0, groundY, config.width, config.groundHeight);

    for (let x = -20; x < config.width + 28; x += 28) {
      ctx.fillStyle = x % 56 === 0 ? skin.groundStripe : "rgba(255,255,255,0.08)";
      ctx.fillRect(x, groundY + 12, 18, 12);
    }
  }

  drawCloud(x, y, width, color) {
    const wrappedX = ((x % (this.config.width + 140)) + (this.config.width + 140)) % (this.config.width + 140) - 70;
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.ellipse(wrappedX, y, width, width * 0.42, 0, 0, Math.PI * 2);
    this.ctx.ellipse(wrappedX + width * 0.7, y + 2, width * 0.64, width * 0.32, 0, 0, Math.PI * 2);
    this.ctx.fill();
  }

  render() {
    const { ctx, config } = this;
    const shakeX = this.screenShake > 0 ? (Math.random() - 0.5) * this.screenShake : 0;
    const shakeY = this.screenShake > 0 ? (Math.random() - 0.5) * this.screenShake : 0;
    ctx.clearRect(0, 0, config.width, config.height);
    ctx.save();
    ctx.translate(shakeX, shakeY);
    this.renderBackground();
    this.pipeStore.draw(ctx);
    this.particles.draw(ctx);
    this.remotePlayers.draw(ctx);
    this.primaryBird.draw(ctx, {
      palette: getBirdPalette("local", true),
      ghost: this.mode === "gameover",
    });
    ctx.restore();
  }

  renderGameToText() {
    const bird = this.primaryBird;
    const payload = {
      coordinateSystem: "origin top-left, +x right, +y down",
      mode: this.mode,
      playerName: this.playerProfile.name,
      connection: this.ui.connectionValue.textContent,
      roomId: this.currentRoomId,
      roomMessage: this.ui.roomMessage.textContent,
      theme: this.theme,
      muted: this.sound.muted,
      score: this.score,
      bird: {
        x: Number(bird.x.toFixed(2)),
        y: Number(bird.y.toFixed(2)),
        velocityY: Number(bird.velocityY.toFixed(2)),
      },
      remotePlayers: this.remotePlayers.toSerializable(),
      scoreboard: Object.values(this.scoreboardPlayers || {}).map((player) => ({
        id: player.id,
        name: player.name || "Player",
        score: Number.isFinite(player.score) ? player.score : 0,
        isAlive: Boolean(player.isAlive),
      })),
      pipes: this.pipeStore.toSerializable(),
      particles: this.particles.items.length,
    };

    return JSON.stringify(payload);
  }

  advanceTime(ms) {
    const step = 1000 / 60;
    const iterations = Math.max(1, Math.round(ms / step));
    for (let index = 0; index < iterations; index += 1) {
      this.update(step / 1000);
    }
    this.render();
  }
}

const canvas = document.getElementById("gameCanvas");
const ui = {
  overlay: document.getElementById("overlay"),
  overlayTitle: document.getElementById("overlayTitle"),
  overlayMessage: document.getElementById("overlayMessage"),
  startScreen: document.getElementById("startScreen"),
  gameOverScreen: document.getElementById("gameOverScreen"),
  createRoomButton: document.getElementById("createRoomButton"),
  joinRoomButton: document.getElementById("joinRoomButton"),
  joinRoomInput: document.getElementById("joinRoomInput"),
  roomMessage: document.getElementById("roomMessage"),
  startButton: document.getElementById("startButton"),
  restartButton: document.getElementById("restartButton"),
  themeToggleButton: document.getElementById("themeToggleButton"),
  muteToggleButton: document.getElementById("muteToggleButton"),
  playerNameInput: document.getElementById("playerNameInput"),
  playerNameValue: document.getElementById("playerNameValue"),
  roomValue: document.getElementById("roomValue"),
  gameOverPlayer: document.getElementById("gameOverPlayer"),
  gameOverScore: document.getElementById("gameOverScore"),
  scoreValue: document.getElementById("scoreValue"),
  connectionValue: document.getElementById("connectionValue"),
  scoreboardList: document.getElementById("scoreboardList"),
};

const game = new FlappyGame(canvas, ui);
window.game = game;
window.render_game_to_text = () => game.renderGameToText();
window.advanceTime = (ms) => game.advanceTime(ms);
