const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const rooms = {};

const generateRoomCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const addLog = (room, type, message) => {
  if (!room.logs) room.logs = [];
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  room.logs.unshift({ type, message, time });
  if (room.logs.length > 30) room.logs.pop();
};

io.on('connection', (socket) => {
  // 1. Create Room
  socket.on('CREATE_ROOM', ({ hostName, hostPassword, participantPassword, joinMethod }) => {
    if (!hostPassword || !participantPassword) {
      return socket.emit('ERROR', { message: 'Both Host and Participant passwords are required!' });
    }
    if (hostPassword === participantPassword) {
      return socket.emit('ERROR', { message: 'Host password and Participant password cannot be the same!' });
    }

    const roomCode = generateRoomCode();
    rooms[roomCode] = {
      hostPassword,
      participantPassword,
      teams: {},
      queue: [],
      logs: []
    };

    socket.join(roomCode);
    addLog(rooms[roomCode], 'ROOM CREATED', `${hostName} created room via ${joinMethod}`);
    socket.emit('ROOM_CREATED', { roomCode, logs: rooms[roomCode].logs });
  });

  // 2. Join as Host
  socket.on('JOIN_AS_HOST', ({ roomCode, hostName, hostPassword, joinMethod }) => {
    const room = rooms[roomCode];
    if (!room) return socket.emit('ERROR', { message: 'Room not found!' });
    if (room.hostPassword !== hostPassword) return socket.emit('ERROR', { message: 'Incorrect Host password!' });

    socket.join(roomCode);
    addLog(room, 'HOST JOINED', `${hostName} joined as Host via ${joinMethod}`);
    io.to(roomCode).emit('ACTIVITY_LOGS_UPDATED', room.logs);
    socket.emit('HOST_JOIN_SUCCESS', { roomCode, teams: room.teams, queue: room.queue, logs: room.logs });
  });

  // 3. Participant Initial Authentication
  socket.on('JOIN_ROOM_INITIAL', ({ roomCode, playerName, participantPassword, joinMethod }) => {
    const room = rooms[roomCode];
    if (!room) return socket.emit('ERROR', { message: 'Room not found!' });
    if (room.participantPassword !== participantPassword) return socket.emit('ERROR', { message: 'Incorrect Participant password!' });

    socket.join(roomCode);
    addLog(room, 'PARTICIPANT JOINED', `${playerName} joined room via ${joinMethod}`);
    io.to(roomCode).emit('ACTIVITY_LOGS_UPDATED', room.logs);
    socket.emit('JOIN_SUCCESS', { roomCode, teamName: '', teams: room.teams, logs: room.logs });
  });

  // 4. Host creates a team
  socket.on('CREATE_TEAM', ({ roomCode, teamName }) => {
    const room = rooms[roomCode];
    if (!room) return;
    if (room.teams[teamName]) {
      return socket.emit('ERROR', { message: 'Team name already exists!' });
    }

    room.teams[teamName] = { score: 0, members: [] };
    addLog(room, 'TEAM CREATED', `Host created team "${teamName}"`);
    io.to(roomCode).emit('TEAMS_UPDATED', room.teams);
    io.to(roomCode).emit('ACTIVITY_LOGS_UPDATED', room.logs);
  });

  // 5. Participant joins specific team
  socket.on('JOIN_TEAM_SPECIFIC', ({ roomCode, teamName, playerName }) => {
    const room = rooms[roomCode];
    if (!room || !room.teams[teamName]) return;

    // Remove player from other teams if already in one
    Object.keys(room.teams).forEach((t) => {
      room.teams[t].members = room.teams[t].members.filter(m => m !== playerName);
    });

    if (!room.teams[teamName].members.includes(playerName)) {
      room.teams[teamName].members.push(playerName);
    }

    addLog(room, 'TEAM JOINED', `${playerName} joined team "${teamName}"`);
    socket.emit('JOIN_SUCCESS', { roomCode, teamName, teams: room.teams, logs: room.logs });
    io.to(roomCode).emit('TEAMS_UPDATED', room.teams);
    io.to(roomCode).emit('ACTIVITY_LOGS_UPDATED', room.logs);
  });

  socket.on('PRESS_BUZZER', ({ roomCode, teamName, playerName }) => {
    const room = rooms[roomCode];
    if (!room || !room.teams[teamName]) return;

    const alreadyInQueue = room.queue.some((item) => item.teamName === teamName);
    if (!alreadyInQueue) {
      room.queue.push({ teamName, playerName, timestamp: Date.now() });
      addLog(room, 'BUZZER', `Team "${teamName}" (${playerName}) buzzed in!`);
      io.to(roomCode).emit('BUZZER_QUEUE_UPDATED', { queue: room.queue });
      io.to(roomCode).emit('ACTIVITY_LOGS_UPDATED', room.logs);
    }
  });

  socket.on('RESET_BUZZER', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;
    room.queue = [];
    addLog(room, 'BUZZER RESET', `Host reset all buzzers`);
    io.to(roomCode).emit('BUZZER_RESET');
    io.to(roomCode).emit('ACTIVITY_LOGS_UPDATED', room.logs);
  });

  socket.on('PASS_TO_NEXT', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.queue.length === 0) return;
    const passed = room.queue.shift();
    addLog(room, 'PASS', `Team "${passed.teamName}" skipped`);
    io.to(roomCode).emit('BUZZER_QUEUE_UPDATED', { queue: room.queue });
    io.to(roomCode).emit('ACTIVITY_LOGS_UPDATED', room.logs);
  });

  socket.on('UPDATE_SCORE_AND_NEXT_QUESTION', ({ roomCode, teamName, delta }) => {
    const room = rooms[roomCode];
    if (room && room.teams[teamName]) {
      room.teams[teamName].score = Math.max(0, room.teams[teamName].score + delta);
      room.queue = [];
      addLog(room, 'SCORE UPDATED', `Team "${teamName}" awarded +${delta} pts`);
      io.to(roomCode).emit('TEAMS_UPDATED', room.teams);
      io.to(roomCode).emit('BUZZER_RESET');
      io.to(roomCode).emit('ACTIVITY_LOGS_UPDATED', room.logs);
    }
  });

  socket.on('REMOVE_PLAYER', ({ roomCode, teamName, playerName }) => {
    const room = rooms[roomCode];
    if (room && room.teams[teamName]) {
      room.teams[teamName].members = room.teams[teamName].members.filter(m => m !== playerName);
      
      addLog(room, 'PLAYER REMOVED', `Host removed ${playerName} from ${teamName}`);
      io.to(roomCode).emit('PLAYER_REMOVED', { teamName, playerName });
      io.to(roomCode).emit('HOST_ACTION_NOTICE', { message: `Player "${playerName}" from team "${teamName}" was removed by Host.` });

      if (room.teams[teamName].members.length === 0) {
        delete room.teams[teamName];
        room.queue = room.queue.filter(item => item.teamName !== teamName);
        io.to(roomCode).emit('BUZZER_QUEUE_UPDATED', { queue: room.queue });
      }

      io.to(roomCode).emit('TEAMS_UPDATED', room.teams);
      io.to(roomCode).emit('ACTIVITY_LOGS_UPDATED', room.logs);
    }
  });

  socket.on('REMOVE_TEAM', ({ roomCode, teamName }) => {
    const room = rooms[roomCode];
    if (room && room.teams[teamName]) {
      delete room.teams[teamName];
      room.queue = room.queue.filter(item => item.teamName !== teamName);
      
      addLog(room, 'TEAM REMOVED', `Host deleted team "${teamName}"`);
      io.to(roomCode).emit('TEAM_REMOVED', { teamName });
      io.to(roomCode).emit('HOST_ACTION_NOTICE', { message: `Team "${teamName}" was removed by Host.` });

      io.to(roomCode).emit('TEAMS_UPDATED', room.teams);
      io.to(roomCode).emit('BUZZER_QUEUE_UPDATED', { queue: room.queue });
      io.to(roomCode).emit('ACTIVITY_LOGS_UPDATED', room.logs);
    }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Backend running on port ${PORT}`));