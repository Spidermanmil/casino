const express = require('express');
const { Server } = require('socket.io');
const { kv } = require('@vercel/kv');

const app = express();
app.use(express.json());

const generateRoomCode = () => Math.random().toString(36).substring(2, 6).toUpperCase();

app.post('/api/room/create', async (req, res) => {
  const { playerName } = req.body;
  if (!playerName) {
    return res.status(400).json({ error: 'Player name is required' });
  }

  let roomCode = generateRoomCode();
  while (await kv.exists(roomCode)) {
    roomCode = generateRoomCode();
  }

  const room = {
    code: roomCode,
    players: [{ id: Date.now().toString(), name: playerName, chips: 100, isHost: true }],
    pot: 0,
  };

  await kv.set(roomCode, room);
  res.json({ roomCode, playerId: room.players[0].id });
});

app.post('/api/room/join', async (req, res) => {
  const { roomCode, playerName } = req.body;
  const room = await kv.get(roomCode);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const newPlayer = { id: Date.now().toString(), name: playerName, chips: 100, isHost: false };
  room.players.push(newPlayer);
  await kv.set(roomCode, room);
  res.json({ playerId: newPlayer.id });
});

const handler = (req, res) => {
  if (!res.socket.server.io) {
    console.log('Initializing Socket.IO server...');
    const io = new Server(res.socket.server);

    io.on('connection', (socket) => {
      console.log('Client connected:', socket.id);

      socket.on('joinRoom', async ({ roomCode, playerId }) => {
        const room = await kv.get(roomCode);
        if (room) {
          socket.join(roomCode);
          io.to(roomCode).emit('roomUpdate', room);
        }
      });

      socket.on('addChips', async ({ roomCode, playerId, amount }) => {
        const room = await kv.get(roomCode);
        if (room) {
          const player = room.players.find(p => p.id === playerId);
          if (player) {
            player.chips += amount;
            await kv.set(roomCode, room);
            io.to(roomCode).emit('roomUpdate', room);
          }
        }
      });

      socket.on('decideWinner', async ({ roomCode, winnerId }) => {
        const room = await kv.get(roomCode);
        if (room) {
          const winner = room.players.find(p => p.id === winnerId);
          if (winner) {
            winner.chips += room.pot;
            room.pot = 0;
            await kv.set(roomCode, room);
            io.to(roomCode).emit('roomUpdate', room);
          }
        }
      });

      socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
      });
    });

    res.socket.server.io = io;
  }
  app(req, res);
};

module.exports = handler;
