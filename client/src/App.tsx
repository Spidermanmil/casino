import { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import './App.css';

const API_URL = ''; // Use relative path for production

interface Player {
  id: string;
  name: string;
  chips: number;
  isHost: boolean;
}

interface Room {
  code: string;
  players: Player[];
  pot: number;
  currentBets: Record<string, number>;
  gameStarted: boolean;
}

function App() {
  const [screen, setScreen] = useState<'home' | 'lobby' | 'game'>('home');
  const [playerName, setPlayerName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [room, setRoom] = useState<Room | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  
  const showToast = (title: string, status: 'success' | 'error' | 'info' = 'info', description?: string) => {
    alert(`${title}: ${description || ''}`);
  };

  useEffect(() => {
    // Initialize socket connection
    const newSocket = io({ path: '/api/socket.io/' });
    setSocket(newSocket);

    // Clean up on unmount
    return () => {
      newSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!socket) return;

    socket.on('roomUpdate', (updatedRoom: Room) => {
      console.log('Received roomUpdate:', updatedRoom);
      setRoom(updatedRoom);
      if (updatedRoom.gameStarted) {
        console.log('Game has started, switching to game screen.');
        setScreen('game');
      } else {
        setScreen('lobby');
      }
    });

    return () => {
      socket.off('roomUpdate');
    };
  }, [socket]);

  const createRoom = async () => {
    if (!playerName.trim()) {
      showToast('Error', 'error', 'Please enter your name');
      return;
    }

    try {
      const response = await axios.post(`${API_URL}/api/room/create`, {
        playerName: playerName.trim(),
      });

      setPlayerId(response.data.playerId);
      setRoomCode(response.data.roomCode);
      socket?.emit('joinRoom', {
        roomCode: response.data.roomCode,
        playerId: response.data.playerId,
      });
      setScreen('lobby');
    } catch (error) {
      showToast('Error', 'error', 'Failed to create room');
    }
  };

  const joinRoom = async () => {
    if (!playerName.trim() || !roomCode.trim()) {
      showToast('Error', 'error', 'Please enter your name and room code');
      return;
    }

    try {
      const response = await axios.post(`${API_URL}/api/room/join`, {
        roomCode: roomCode.trim().toUpperCase(),
        playerName: playerName.trim(),
      });

      setPlayerId(response.data.playerId);
      setRoomCode(roomCode.trim().toUpperCase());
      socket?.emit('joinRoom', {
        roomCode: roomCode.trim().toUpperCase(),
        playerId: response.data.playerId,
      });
      setScreen('lobby');
    } catch (error: any) {
      showToast('Error', 'error', error.response?.data?.error || 'Failed to join room');
    }
  };

  const startGame = () => {
    if (!socket || !room) return;
    console.log(`Emitting startGame for room: ${roomCode}`);
    socket.emit('startGame', { roomCode });
  };

  const placeBet = (amount: number) => {
    if (!socket || !room) return;
    socket.emit('placeBet', { amount, playerId, roomCode });
  };

  const decideWinner = (winnerId: string) => {
    if (!socket || !room) return;
    socket.emit('decideWinner', { roomCode, winnerId });
  };

  const addChips = (playerId: string, amount: number) => {
    if (!socket || !room || !amount || amount <= 0) return;
    socket.emit('addChips', { roomCode, playerId, amount });
  };

  if (screen === 'home') {
    return (
      <div className="app">
        <div className="container">
          <h1>🃏 Card Chip Manager</h1>
          <div className="form-group">
            <input
              type="text"
              placeholder="Your Name"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              className="input"
            />
          </div>
          <button onClick={createRoom} className="btn btn-primary">
            Create New Room
          </button>
          <div className="divider">OR</div>
          <div className="form-group">
            <input
              type="text"
              placeholder="Room Code"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              className="input"
            />
          </div>
          <button onClick={joinRoom} className="btn btn-secondary">
            Join Existing Room
          </button>
        </div>
      </div>
    );
  }

  if (screen === 'lobby') {
    return (
      <div className="app">
        <div className="container">
          <h1>Room: {roomCode}</h1>
          <p className="room-code">Share this code with friends: <strong>{roomCode}</strong></p>
          
          <div className="players-section">
            <h2>Players ({room?.players.length || 0}/10)</h2>
            <div className="players-grid">
              {room?.players.map((player) => (
                <div key={player.id} className="player-card">
                  <div className="player-name">{player.name} {player.isHost && '👑'}</div>
                  <div className="player-chips">Chips: {player.chips}</div>
                </div>
              ))}
            </div>
          </div>

          {room?.players.some(p => p.id === playerId && p.isHost) && (
            <button 
              onClick={startGame} 
              disabled={(room?.players.length || 0) < 2}
              className="btn btn-success"
            >
              Start Game
            </button>
          )}
        </div>
      </div>
    );
  }

  if (screen === 'game') {
    const currentPlayer = room?.players.find(p => p.id === playerId);
    
    return (
      <div className="app">
        <div className="container">
          <h1>Game Room: {roomCode}</h1>
          
          <div className="pot-section">
            <h2>💰 Pot: {room?.pot || 0} chips</h2>
          </div>
          
          <div className="players-section">
            <div className="players-grid">
              {room?.players.map((player) => (
                <div 
                  key={player.id} 
                  className={`player-card ${player.id === playerId ? 'current-player' : ''}`}
                >
                  <div className="player-name">{player.name} {player.isHost && '👑'}</div>
                  <div className="player-chips">Chips: {player.chips}</div>
                  {room.currentBets[player.id] > 0 && (
                    <div className="player-bet">Bet: {room.currentBets[player.id]}</div>
                  )}
                  {currentPlayer?.isHost && (
                    <div className="host-controls">
                      <button onClick={() => decideWinner(player.id)} className="btn btn-sm btn-winner">Declare Winner</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          
          <div className="betting-section">
            <h3>Place your bets! 🎲</h3>
            <div className="betting-controls">
              {[10, 20, 50, 100].map((amount) => (
                <button 
                  key={amount} 
                  onClick={() => placeBet(amount)}
                  disabled={!currentPlayer || currentPlayer.chips < amount}
                  className="btn btn-bet"
                >
                  {amount}
                </button>
              ))}
              <input 
                type="number" 
                placeholder="Custom amount" 
                className="input bet-input"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const amount = parseInt(e.currentTarget.value);
                    if (currentPlayer && amount > 0 && amount <= currentPlayer.chips) {
                      placeBet(amount);
                      e.currentTarget.value = '';
                    }
                  }
                }}
              />
            </div>
            {currentPlayer && (
              <p className="chips-remaining">Your chips: {currentPlayer.chips}</p>
            )}
          </div>

          {currentPlayer?.isHost && (
            <div className="host-panel">
              <h3>Host Controls</h3>
              <div className="add-chips-form">
                <select id="player-select" className="input">
                  {room?.players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input id="add-chips-amount" type="number" placeholder="Amount" className="input bet-input" />
                <button 
                  className="btn btn-secondary"
                  onClick={() => {
                    const selectedPlayerId = (document.getElementById('player-select') as HTMLSelectElement).value;
                    const amountInput = (document.getElementById('add-chips-amount') as HTMLInputElement);
                    const amount = parseInt(amountInput.value);
                    if (!isNaN(amount) && amount > 0) {
                      addChips(selectedPlayerId, amount);
                      amountInput.value = '';
                    } else {
                      showToast('Error', 'error', 'Please enter a valid amount');
                    }
                  }}
                >Add Chips</button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}

export default App;
