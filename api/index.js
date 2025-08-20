const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

const rooms = new Map();

const generateRoomCode = () => Math.random().toString(36).substring(2, 6).toUpperCase();

app.post('/api/room/create', (req, res) => {
  const { playerName } = req.body;
  if (!playerName) {
    return res.status(400).json({ error: 'Player name is required' });
  }

  let roomCode;
  do {
    roomCode = generateRoomCode();
  } while (rooms.has(roomCode));

  const room = {
    code: roomCode,
    players: [{ id: Date.now().toString(), name: playerName, chips: 100, isHost: true }],
    pot: 0,
    currentBets: {},
    currentRoundBets: {},
    minBet: 10,
    currentTurn: null,
    gameStarted: false
  };

  rooms.set(roomCode, room);
  res.json({ roomCode, playerId: room.players[0].id });
});

app.post('/api/room/join', (req, res) => {
  const { roomCode, playerName } = req.body;
  if (!roomCode || !playerName) {
    return res.status(400).json({ error: 'Room code and player name are required' });
  }

  const room = rooms.get(roomCode);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  if (room.players.length >= 10) {
    return res.status(400).json({ error: 'Room is full' });
  }

  const newPlayer = { id: Date.now().toString(), name: playerName, chips: 100, isHost: false };
  room.players.push(newPlayer);
  res.json({ playerId: newPlayer.id });
});

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('joinRoom', ({ roomCode, playerId }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.playerId = playerId;
    io.to(roomCode).emit('roomUpdate', room);
  });

  socket.on('startGame', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (room) {
      room.gameStarted = true;
      io.to(roomCode).emit('roomUpdate', room);
    }
  });

  socket.on('placeBet', ({ amount, playerId, roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const player = room.players.find(p => p.id === playerId);
    if (player && player.chips >= amount) {
      player.chips -= amount;
      room.pot += amount;
      io.to(roomCode).emit('roomUpdate', room);
    }
  });

  socket.on('decideWinner', ({ roomCode, winnerId }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const winner = room.players.find(p => p.id === winnerId);
    if (winner) {
      winner.chips += room.pot;
      room.pot = 0;
      io.to(roomCode).emit('roomUpdate', room);
    }
  });

  socket.on('addChips', ({ roomCode, playerId, amount }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const player = room.players.find(p => p.id === playerId);
    if (player) {
      player.chips += amount;
      io.to(roomCode).emit('roomUpdate', room);
    }
  });

  socket.on('disconnect', () => {
    if (socket.roomCode) {
      const room = rooms.get(socket.roomCode);
      if (room) {
        room.players = room.players.filter(p => p.id !== socket.playerId);
        if (room.players.length === 0) {
          rooms.delete(socket.roomCode);
        } else {
          if (!room.players.some(p => p.isHost)) {
            room.players[0].isHost = true;
          }
          io.to(socket.roomCode).emit('roomUpdate', room);
        }
      }
    }
  });
});

// This is the Vercel request handler
module.exports = (req, res) => {
  // Attach socket.io to the server if it's not already attached
  if (!res.socket.server.io) {
    console.log('Attaching socket.io to server');
    const io = new Server(res.socket.server, {
      path: '/socket.io',
      cors: { origin: '*' }
    });
    res.socket.server.io = io;
  }
  // Handle the request with the express app
  app(req, res);
};
