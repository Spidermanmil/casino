const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  ...(process.env.VERCEL && { path: '/api/socket.io/' }),
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Store active rooms and players
const rooms = new Map();

// Generate a random 4-letter room code
const generateRoomCode = () => {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
};

// Create a new game room
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
    players: [
      {
        id: Date.now().toString(),
        name: playerName,
        chips: 100,
        isHost: true
      }
    ],
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

// Join an existing room
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

  const newPlayer = {
    id: Date.now().toString(),
    name: playerName,
    chips: 100,
    isHost: false
  };

  room.players.push(newPlayer);
  res.json({ playerId: newPlayer.id });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('joinRoom', ({ roomCode, playerId }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.playerId = playerId;

    // Send updated room data to all clients in the room
    io.to(roomCode).emit('roomUpdate', room);
  });

  socket.on('startGame', ({ roomCode }) => {
    console.log(`[Socket ${socket.id}] Received startGame for room: ${roomCode}`);
    const room = rooms.get(roomCode);
    if (!room) {
      console.error(`Room ${roomCode} not found.`);
      return;
    }

    const player = room.players.find(p => p.id === socket.playerId);
    if (!player || !player.isHost) {
      console.error(`Player ${socket.playerId} is not the host of room ${roomCode}.`);
      return;
    }

    room.gameStarted = true;
    console.log(`Game started in room ${roomCode}. Emitting roomUpdate.`);
    io.to(roomCode).emit('roomUpdate', room);
  });

  socket.on('placeBet', ({ amount, playerId, roomCode }) => {
    console.log(`[Socket ${socket.id}] Received placeBet for ${amount} from player ${playerId} in room ${roomCode}`);
    const room = rooms.get(roomCode);
    if (!room) {
        console.error(`Room ${roomCode} not found for placeBet.`);
        return;
    }

    const player = room.players.find(p => p.id === playerId);
    if (!player) {
        console.error(`Player ${playerId} not found in room ${roomCode}.`);
        return;
    }

    if (player.chips < amount) {
        console.error(`Player ${playerId} has insufficient chips.`);
        return;
    }

    player.chips -= amount;
    room.pot += amount;
    room.currentBets[playerId] = (room.currentBets[playerId] || 0) + amount;
    room.currentRoundBets[playerId] = (room.currentRoundBets[playerId] || 0) + amount;

    io.to(roomCode).emit('roomUpdate', room);
  });

  socket.on('decideWinner', ({ roomCode, winnerId }) => {
    console.log(`[Socket ${socket.id}] Received decideWinner for room ${roomCode}, winnerId: ${winnerId}`);
    const room = rooms.get(roomCode);
    if (!room) {
      console.error(`Room ${roomCode} not found for decideWinner.`);
      return;
    }

    const host = room.players.find(p => p.id === socket.playerId);
    if (!host || !host.isHost) {
      console.error(`Player ${socket.playerId} is not the host of room ${roomCode}.`);
      return;
    }

    const winner = room.players.find(p => p.id === winnerId);
    if (!winner) {
      console.error(`Winner with ID ${winnerId} not found in room ${roomCode}.`);
      return;
    }

    console.log(`Before update - Pot: ${room.pot}, Winner chips: ${winner.chips}`);

    winner.chips += room.pot;
    room.pot = 0;
    room.currentBets = {};
    room.currentRoundBets = {};

    console.log(`After update - Pot: ${room.pot}, Winner chips: ${winner.chips}`);

    io.to(roomCode).emit('roomUpdate', room);
  });

  socket.on('addChips', ({ roomCode, playerId, amount }) => {
    console.log(`[Socket ${socket.id}] Received addChips for room ${roomCode}, playerId: ${playerId}, amount: ${amount}`);
    const room = rooms.get(roomCode);
    if (!room) {
      console.error(`Room ${roomCode} not found for addChips.`);
      return;
    }

    const host = room.players.find(p => p.id === socket.playerId);
    if (!host || !host.isHost) {
      console.error(`Player ${socket.playerId} is not the host of room ${roomCode}.`);
      return;
    }

    const player = room.players.find(p => p.id === playerId);
    if (!player) {
      console.error(`Player with ID ${playerId} not found in room ${roomCode}.`);
      return;
    }

    console.log(`Before update - Player ${playerId} chips: ${player.chips}`);
    player.chips += amount;
    console.log(`After update - Player ${playerId} chips: ${player.chips}`);

    io.to(roomCode).emit('roomUpdate', room);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    // Handle player disconnection
    if (socket.roomCode) {
      const room = rooms.get(socket.roomCode);
      if (room) {
        // Remove the player if they disconnect
        room.players = room.players.filter(p => p.id !== socket.playerId);
        
        // If no players left, remove the room
        if (room.players.length === 0) {
          rooms.delete(socket.roomCode);
        } else {
          // If host left, assign new host
          if (room.players.length > 0 && !room.players.some(p => p.isHost)) {
            room.players[0].isHost = true;
          }
          io.to(socket.roomCode).emit('roomUpdate', room);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
