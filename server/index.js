const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling']
});

const rooms = {};

function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function getTimestamp() {
  const now = new Date();
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function addLog(room, type, message) {
  if (!room.logs) room.logs = [];
  room.logs.unshift({ type, message, time: getTimestamp() });
  if (room.logs.length > 50) room.logs.pop();
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // 1. CREATE ROOM
  socket.on('CREATE_ROOM', ({ hostName, hostPassword, participantPassword, joinMethod }) => {
    const roomCode = generateRoomCode();
    
    rooms[roomCode] = {
      hostName,
      hostPassword,
      participantPassword,
      teams: {},
      queue: [],
      logs: []
    };

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.role = 'HOST';

    addLog(rooms[roomCode], 'ROOM', `Room created by ${hostName} via ${joinMethod}`);
    
    socket.emit('ROOM_CREATED', { roomCode, logs: rooms[roomCode].logs });
  });

  // 2. JOIN AS HOST (ALLOWS 9676 AS MASTER ADMIN OVERRIDE)
  socket.on('JOIN_AS_HOST', ({ roomCode, hostName, hostPassword, joinMethod }) => {
    const room = rooms[roomCode];
    if (!room) {
      return socket.emit('ERROR', { message: 'Room not found! Please check the Room ID.' });
    }
    
    const isMasterAdmin = hostPassword === '9676';
    if (room.hostPassword !== hostPassword && !isMasterAdmin) {
      return socket.emit('ERROR', { message: 'Incorrect Host Password!' });
    }

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.role = 'HOST';

    const adminLabel = isMasterAdmin ? 'Master Admin' : 'Co-Host';
    addLog(room, 'HOST', `${hostName} joined as ${adminLabel} via ${joinMethod}`);
    io.to(roomCode).emit('ACTIVITY_LOGS_UPDATED', room.logs);

    socket.emit('HOST_JOIN_SUCCESS', {
      roomCode,
      teams: room.teams,
      queue: room.queue,
      logs: room.logs
    });
  });

  // 3. JOIN ROOM INITIAL (PARTICIPANT)
  socket.on('JOIN_ROOM_INITIAL', ({ roomCode, playerName, participantPassword, joinMethod }) => {
    const room = rooms[roomCode];
    if (!room) {
      return socket.emit('ERROR', { message: 'Room not found! Please check the Room ID.' });
    }
    if (room.participantPassword !== participantPassword) {
      return socket.emit('ERROR', { message: 'Incorrect Participant Password!' });
    }

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.playerName = playerName;

    addLog(room, 'PARTICIPANT', `${playerName} entered room via ${joinMethod}`);
    io.to(roomCode).emit('ACTIVITY_LOGS_UPDATED', room.logs);

    socket.emit('JOIN_SUCCESS', {
      roomCode,
      teamName: '',
      teams: room.teams,
      logs: room.logs
    });
  });

  // 4. CREATE TEAM
  socket.on('CREATE_TEAM', ({ roomCode, teamName }) => {
    const room = rooms[roomCode];
    if (!room) return;

    if (room.teams[teamName]) {
      return socket.emit('ERROR', { message: 'Team name already exists!' });
    }

    room.teams[teamName] = { score: 0, members: [] };
    
    addLog(room, 'TEAM', `New team created: "${teamName}"`);
    
    io.to(roomCode).emit('TEAMS_UPDATED', room.teams);
    io.to(roomCode).emit('ACTIVITY_LOGS_UPDATED', room.logs);
  });

  // 5. JOIN SPECIFIC TEAM
  socket.on('JOIN_TEAM_SPECIFIC', ({ roomCode, teamName, playerName }) => {
    const room = rooms[roomCode];
    if (!room || !room.teams[teamName]) {
      return socket.emit('ERROR', { message: 'Team does not exist!' });
    }

    Object.keys(room.teams).forEach((t) => {
      room.teams[t].members = room.teams[t].members.filter((m) => m !== playerName);
    });

    room.teams[teamName].members.push(playerName);
    socket.teamName = teamName;

    addLog(room, 'TEAM', `${playerName} joined team "${teamName}"`);

    io.to(roomCode).emit('TEAMS_UPDATED', room.teams);
    io.to(roomCode).emit('ACTIVITY_LOGS_UPDATED', room.logs);

    socket.emit('JOIN_SUCCESS', {
      roomCode,
      teamName,
      teams: room.teams,
      logs: room.logs
    });
  });

  // 6. PRESS BUZZER (ORDER / RANK PROCESSING)
  socket.on('PRESS_BUZZER', ({ roomCode, teamName, playerName }) => {
    const room = rooms[roomCode];
    if (!room) return;

    const alreadyBuzzed = room.queue.some((item) => item.teamName === teamName);
    if (alreadyBuzzed) return;

    room.queue.push({
      teamName,
      playerName,
      timestamp: Date.now()
    });

    const rank = room.queue.length;
    addLog(room, 'BUZZ', `⚡ ${teamName} (${playerName}) buzzed in at Position #${rank}!`);

    io.to(roomCode).emit('BUZZER_QUEUE_UPDATED', { queue: room.queue });
    io.to(roomCode).emit('ACTIVITY_LOGS_UPDATED', room.logs);

    if (rank === 1) {
      io.to(roomCode).emit('HOST_ACTION_NOTICE', { message: `⚡ Team "${teamName}" buzzed FIRST (#1)!` });
    }
  });

  // 7. RESET BUZZERS
  socket.on('RESET_BUZZER', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;

    room.queue = [];
    addLog(room, 'BUZZ', 'Host reset all buzzers for the next question.');

    io.to(roomCode).emit('BUZZER_RESET');
    io.to(roomCode).emit('ACTIVITY_LOGS_UPDATED', room.logs);
  });

  // 8. UPDATE SCORE & NEXT QUESTION
  socket.on('UPDATE_SCORE_AND_NEXT_QUESTION', ({ roomCode, teamName, delta }) => {
    const room = rooms[roomCode];
    if (!room || !room.teams[teamName]) return;

    room.teams[teamName].score += delta;
    room.queue = [];

    addLog(room, 'SCORE', `🏆 Team "${teamName}" awarded +${delta} points! (Total: ${room.teams[teamName].score})`);

    io.to(roomCode).emit('TEAMS_UPDATED', room.teams);
    io.to(roomCode).emit('BUZZER_RESET');
    io.to(roomCode).emit('ACTIVITY_LOGS_UPDATED', room.logs);
  });

  // 9. PASS TO NEXT
  socket.on('PASS_TO_NEXT', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.queue.length === 0) return;

    const failedTeam = room.queue.shift();
    addLog(room, 'BUZZ', `❌ Team "${failedTeam.teamName}" was incorrect. Passed to next team!`);

    io.to(roomCode).emit('BUZZER_QUEUE_UPDATED', { queue: room.queue });
    io.to(roomCode).emit('ACTIVITY_LOGS_UPDATED', room.logs);
  });

  // 10. REMOVE PLAYER
  socket.on('REMOVE_PLAYER', ({ roomCode, teamName, playerName }) => {
    const room = rooms[roomCode];
    if (!room || !room.teams[teamName]) return;

    room.teams[teamName].members = room.teams[teamName].members.filter((m) => m !== playerName);
    addLog(room, 'ADMIN', `Host removed player "${playerName}" from team "${teamName}"`);

    io.to(roomCode).emit('TEAMS_UPDATED', room.teams);
    io.to(roomCode).emit('ACTIVITY_LOGS_UPDATED', room.logs);
    io.to(roomCode).emit('PLAYER_REMOVED', { teamName, playerName });
  });

  // 11. REMOVE TEAM
  socket.on('REMOVE_TEAM', ({ roomCode, teamName }) => {
    const room = rooms[roomCode];
    if (!room || !room.teams[teamName]) return;

    delete room.teams[teamName];
    room.queue = room.queue.filter((item) => item.teamName !== teamName);

    addLog(room, 'ADMIN', `Host deleted team "${teamName}"`);

    io.to(roomCode).emit('TEAMS_UPDATED', room.teams);
    io.to(roomCode).emit('BUZZER_QUEUE_UPDATED', { queue: room.queue });
    io.to(roomCode).emit('ACTIVITY_LOGS_UPDATED', room.logs);
    io.to(roomCode).emit('TEAM_REMOVED', { teamName });
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Buzzer backend server running on port ${PORT}`);
});
