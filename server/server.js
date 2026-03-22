const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const TICK_RATE_MS = 100;
const ROOM_ID_LENGTH = 6;

const WORLD_CONFIG = {
  width: 420,
  height: 640,
  groundHeight: 96,
  pipeWidth: 74,
  pipeSpeed: 180,
  pipeGapMin: 140,
  pipeGapMax: 180,
  pipeSpacing: 220,
  pipeMarginTop: 72,
  pipeMarginBottom: 132,
};

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

// Room worlds are isolated so the next phase can swap this object for
// a room service without changing the socket contract.
const rooms = {};

app.use(express.static(path.join(__dirname)));

app.get("/health", (_request, response) => {
  const roomIds = Object.keys(rooms);
  const playerCount = roomIds.reduce((count, roomId) => count + Object.keys(rooms[roomId].players).length, 0);

  response.json({
    ok: true,
    roomCount: roomIds.length,
    playerCount,
  });
});

function createPlayer(socket) {
  return {
    id: socket.id,
    name: "",
    x: 0,
    y: 0,
    velocity: 0,
    score: 0,
    isAlive: false,
    roomId: "",
  };
}

function createRoomState(roomId) {
  return {
    id: roomId,
    players: {},
    pipes: [],
    pipeSpawnDistance: 0,
    nextPipeId: 1,
  };
}

function generateRoomId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let roomId = "";

  do {
    roomId = "";
    for (let index = 0; index < ROOM_ID_LENGTH; index += 1) {
      roomId += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
  } while (rooms[roomId]);

  return roomId;
}

function getRoom(roomId) {
  return rooms[roomId] || null;
}

function randomGapHeight() {
  return WORLD_CONFIG.pipeGapMin + Math.random() * (WORLD_CONFIG.pipeGapMax - WORLD_CONFIG.pipeGapMin);
}

function randomGapY(gapHeight) {
  const minY = WORLD_CONFIG.pipeMarginTop;
  const maxY = WORLD_CONFIG.height - WORLD_CONFIG.groundHeight - WORLD_CONFIG.pipeMarginBottom - gapHeight;
  return minY + Math.random() * Math.max(1, maxY - minY);
}

function createPipe(room, x = WORLD_CONFIG.width + 40) {
  const gapHeight = randomGapHeight();
  return {
    id: `pipe-${room.id}-${room.nextPipeId++}`,
    x,
    gapY: randomGapY(gapHeight),
    gapHeight,
    speed: WORLD_CONFIG.pipeSpeed,
    width: WORLD_CONFIG.pipeWidth,
  };
}

function ensureInitialPipe(room) {
  if (room.pipes.length === 0) {
    room.pipes.push(createPipe(room));
    room.pipeSpawnDistance = 0;
  }
}

function updateRoomPipes(room, deltaSeconds) {
  ensureInitialPipe(room);

  room.pipes.forEach((pipe) => {
    pipe.x -= pipe.speed * deltaSeconds;
  });

  room.pipes = room.pipes.filter((pipe) => pipe.x + pipe.width > -30);
  room.pipeSpawnDistance += WORLD_CONFIG.pipeSpeed * deltaSeconds;

  if (room.pipeSpawnDistance >= WORLD_CONFIG.pipeSpacing) {
    room.pipes.push(createPipe(room));
    room.pipeSpawnDistance = 0;
  }
}

function sanitizePlayerUpdate(existingPlayer, payload = {}) {
  return {
    ...existingPlayer,
    name: typeof payload.name === "string" ? payload.name.trim().slice(0, 32) : existingPlayer.name,
    x: Number.isFinite(payload.x) ? payload.x : existingPlayer.x,
    y: Number.isFinite(payload.y) ? payload.y : existingPlayer.y,
    velocity: Number.isFinite(payload.velocity) ? payload.velocity : existingPlayer.velocity,
    score: Number.isFinite(payload.score) ? payload.score : existingPlayer.score,
    isAlive: typeof payload.isAlive === "boolean" ? payload.isAlive : existingPlayer.isAlive,
  };
}

function serializeRoomPlayers(room) {
  return room.players;
}

function serializeRoomPipes(room) {
  return room.pipes;
}

function emitRoomPlayers(roomId) {
  const room = getRoom(roomId);
  if (!room) {
    return;
  }

  io.to(roomId).emit("roomPlayersUpdate", {
    roomId,
    players: serializeRoomPlayers(room),
  });
}

function emitRoomPipes(roomId) {
  const room = getRoom(roomId);
  if (!room) {
    return;
  }

  io.to(roomId).emit("roomPipesUpdate", {
    roomId,
    pipes: serializeRoomPipes(room),
  });
}

function emitFullRoomState(socket, roomId) {
  const room = getRoom(roomId);
  if (!room) {
    return;
  }

  socket.emit("roomPlayersUpdate", {
    roomId,
    players: serializeRoomPlayers(room),
  });

  socket.emit("roomPipesUpdate", {
    roomId,
    pipes: serializeRoomPipes(room),
  });
}

function cleanupRoom(roomId) {
  const room = getRoom(roomId);
  if (!room) {
    return;
  }

  if (Object.keys(room.players).length === 0) {
    delete rooms[roomId];
  }
}

function leaveCurrentRoom(socket, options = {}) {
  const player = options.player || createPlayer(socket);
  const previousRoomId = player.roomId;
  if (!previousRoomId) {
    return;
  }

  const room = getRoom(previousRoomId);
  if (!room) {
    player.roomId = "";
    return;
  }

  delete room.players[socket.id];
  socket.leave(previousRoomId);
  player.roomId = "";
  emitRoomPlayers(previousRoomId);
  cleanupRoom(previousRoomId);
}

function joinRoom(socket, player, roomId) {
  const normalizedRoomId = String(roomId || "").trim().toUpperCase();
  const room = getRoom(normalizedRoomId);

  if (!room) {
    return {
      ok: false,
      error: "Room not found.",
    };
  }

  if (player.roomId === normalizedRoomId) {
    return {
      ok: false,
      error: "Already in that room.",
    };
  }

  leaveCurrentRoom(socket, { player });

  player.roomId = normalizedRoomId;
  room.players[socket.id] = {
    ...player,
    roomId: normalizedRoomId,
  };

  socket.join(normalizedRoomId);
  ensureInitialPipe(room);

  return {
    ok: true,
    roomId: normalizedRoomId,
  };
}

function createRoomForSocket(socket, player) {
  const roomId = generateRoomId();
  rooms[roomId] = createRoomState(roomId);
  return joinRoom(socket, player, roomId);
}

function logPlayerEvent(type, socketId, detail) {
  console.log(`[socket] ${type}: ${socketId} | ${detail}`);
}

io.on("connection", (socket) => {
  const player = createPlayer(socket);
  logPlayerEvent("connected", socket.id, "awaiting room assignment");

  socket.on("createRoom", (callback) => {
    const result = createRoomForSocket(socket, player);
    if (typeof callback === "function") {
      callback(result);
    }

    if (result.ok) {
      emitFullRoomState(socket, result.roomId);
      emitRoomPlayers(result.roomId);
      logPlayerEvent("room-created", socket.id, `room ${result.roomId}`);
    }
  });

  socket.on("joinRoom", (payload, callback) => {
    const roomId = typeof payload === "string" ? payload : payload?.roomId;
    const result = joinRoom(socket, player, roomId);

    if (typeof callback === "function") {
      callback(result);
    }

    if (result.ok) {
      emitFullRoomState(socket, result.roomId);
      emitRoomPlayers(result.roomId);
      logPlayerEvent("room-joined", socket.id, `room ${result.roomId}`);
    }
  });

  socket.on("playerUpdate", (payload) => {
    if (!player.roomId) {
      return;
    }

    const room = getRoom(player.roomId);
    if (!room || !room.players[socket.id]) {
      return;
    }

    const nextPlayer = sanitizePlayerUpdate(room.players[socket.id], payload);
    room.players[socket.id] = nextPlayer;
    Object.assign(player, nextPlayer);
    emitRoomPlayers(player.roomId);
  });

  socket.on("disconnect", () => {
    const roomId = player.roomId;
    leaveCurrentRoom(socket, { player });
    logPlayerEvent("disconnected", socket.id, roomId ? `left room ${roomId}` : "no room");
  });
});

setInterval(() => {
  Object.values(rooms).forEach((room) => {
    if (Object.keys(room.players).length === 0) {
      return;
    }

    updateRoomPipes(room, TICK_RATE_MS / 1000);
    emitRoomPipes(room.id);
  });
}, TICK_RATE_MS);

server.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
