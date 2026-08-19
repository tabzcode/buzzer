const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ['websocket', 'polling']
});

// Master store holding both active and closed rooms
const rooms = {};

function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function getTimestamp() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function addLog(room, type, message) {
  if (!room.logs) room.logs = [];
  room.logs.unshift({ type, message, time: getTimestamp() });
  if (room.logs.length > 50) room.logs.pop();
}

// Format rooms payload specifically for Root Admin
function getAdminRoomList() {
  return Object.values(rooms).map((r) => {
    let totalMembers = 0;
    Object.values(r.teams || {}).forEach((t) => {
      totalMembers += (t.members || []).length;
    });

    return {
      roomCode: r.roomCode,
      hostName: r.hostName,
      hostPassword: r.hostPassword,
      participantPassword: r.participantPassword,
      createdAt: r.createdAt,
      status: r.status, // 'ACTIVE' or 'CLOSED'
      teamsCount: Object.keys(r.teams || {}).length,
      totalMembers,
      joinMethod: r.joinMethod || 'Manual ID'
    };
  });
}

function broadcastAdminUpdate() {
  io.to('ADMIN_ROOM').emit('ADMIN_ROOMS_UPDATED', getAdminRoomList());
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // 1. CREATE ROOM
  socket.on('CREATE_ROOM', ({ hostName, hostPassword, participantPassword, joinMethod }) => {
    const roomCode = generateRoomCode();
    
    rooms[roomCode] = {
      roomCode,
      hostName,
      hostPassword,
      participantPassword,
      joinMethod,
      createdAt: `${new Date().toLocaleDateString()} ${getTimestamp()}`,
      status: 'ACTIVE',
      teams: {},
      queue: [],
      logs: []
    };

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.role = 'HOST';
    socket.playerName = hostName;

    addLog(rooms[roomCode], 'ROOM', `Room created by ${hostName} via ${joinMethod}`);
    socket.emit('ROOM_CREATED', { roomCode, logs: rooms[roomCode].logs });

    // Broadcast new room creation to Root Admin
    broadcastAdminUpdate();
  });

  // 2. JOIN AS HOST (Or Root Admin Check)
  socket.on('JOIN_AS_HOST', ({ roomCode, hostName, hostPassword, joinMethod }) => {
    // ROOT ADMIN BYPASS: Room 0000 & Password 9676
    if (roomCode === '0000' && hostPassword === '9676') {
      socket.join('ADMIN_ROOM');
      socket.role = 'ROOT_ADMIN';
      socket.playerName = hostName || 'Master Admin';

      return socket.emit('ADMIN_LOGIN_SUCCESS', {
        adminName: socket.playerName,
        roomsList: getAdminRoomList()
      });
    }

    const room = rooms[roomCode];
    if (!room || room.status === 'CLOSED') {
      return socket.emit('ERROR', { message: 'Room not found or has been closed!' });
    }

    if (room.hostPassword !== hostPassword && hostPassword !== '9676') {
      return socket.emit('ERROR', { message: 'Incorrect Host Password!' });
    }

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.role = 'HOST';
    socket.playerName = hostName;

    addLog(room, 'HOST', `${hostName} joined as Co-Host`);
    io.to(roomCode).emit('ACTIVITY_LOGS_UPDATED', room.logs);

    socket.emit('HOST_JOIN_SUCCESS', { roomCode, teams: room.teams, queue: room.queue, logs: room.logs });
    broadcastAdminUpdate();
  });

  // 3. CLOSE / TERMINATE ROOM (HOST or ADMIN)
  socket.on('CLOSE_ROOM', ({ roomCode }) => {
    if (rooms[roomCode]) {
      rooms[roomCode].status = 'CLOSED';
      addLog(rooms[roomCode], 'ROOM', 'Room officially closed.');
      
      io.to(roomCode).emit('KICKED_OUT', { message: 'This room has been closed by the host/admin.' });
      broadcastAdminUpdate();
    }
  });

  // 4. JOIN ROOM INITIAL (PARTICIPANT)
  socket.on('JOIN_ROOM_INITIAL', ({ roomCode, playerName, participantPassword, joinMethod }) => {
    const room = rooms[roomCode];
    if (!room || room.status === 'CLOSED') {
      return socket.emit('ERROR', { message: 'Room not found or closed!' });
    }
    if (room.participantPassword !== participantPassword) {
      return socket.emit('ERROR', { message: 'Incorrect Participant Password!' });
    }

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.playerName = playerName;
    socket.role = 'PARTICIPANT';

    addLog(room, 'PARTICIPANT', `${playerName} entered room via ${joinMethod}`);
    io.to(roomCode).emit('ACTIVITY_LOGS_UPDATED', room.logs);

    socket.emit('JOIN_SUCCESS', { roomCode, teamName: '', teams: room.teams, logs: room.logs });
    broadcastAdminUpdate();
  });

  // 5. JOIN SPECIFIC TEAM
  socket.on('JOIN_TEAM_SPECIFIC', ({ roomCode, teamName, playerName }) => {
    const room = rooms[roomCode];
    if (!room || !room.teams[teamName]) return socket.emit('ERROR', { message: 'Team does not exist!' });

    Object.keys(room.teams).forEach((t) => {
      room.teams[t].members = room.teams[t].members.filter((m) => m !== playerName);
    });

    room.teams[teamName].members.push(playerName);
    
    socket.roomCode = roomCode;
    socket.teamName = teamName;
    socket.playerName = playerName;

    addLog(room, 'TEAM', `${playerName} joined team "${teamName}"`);

    io.to(roomCode).emit('TEAMS_UPDATED', room.teams);
    io.to(roomCode).emit('ACTIVITY_LOGS_UPDATED', room.logs);

    socket.emit('JOIN_SUCCESS', { roomCode, teamName, teams: room.teams, logs: room.logs });
    broadcastAdminUpdate();
  });

  // 6. CREATE TEAM
  socket.on('CREATE_TEAM', ({ roomCode, teamName }) => {
    const room = rooms[roomCode];
    if (!room) return;
    if (room.teams[teamName]) return socket.emit('ERROR', { message: 'Team name already exists!' });

    room.teams[teamName] = { score: 0, members: [] };
    addLog(room, 'TEAM', `New team created: "${teamName}"`);
    
    io.to(roomCode).emit('TEAMS_UPDATED', room.teams);
    io.to(roomCode).emit('ACTIVITY_LOGS_UPDATED', room.logs);
    broadcastAdminUpdate();
  });

  // 7. PRESS BUZZER
  socket.on('PRESS_BUZZER', ({ roomCode, teamName, playerName }) => {
    const room = rooms[roomCode];
    if (!room || room.queue.some((item) => item.teamName === teamName)) return;

    room.queue.push({ teamName, playerName, timestamp: Date.now() });
    const rank = room.queue.length;
    
    addLog(room, 'BUZZ', `⚡ ${teamName} (${playerName}) buzzed in at Position #${rank}!`);

    io.to(roomCode).emit('BUZZER_QUEUE_UPDATED', { queue: room.queue });
    io.to(roomCode).emit('ACTIVITY_LOGS_UPDATED', room.logs);
  });

  // 8. RESET BUZZERS
  socket.on('RESET_BUZZER', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;

    room.queue = [];
    addLog(room, 'BUZZ', 'Host reset all buzzers.');

    io.to(roomCode).emit('BUZZER_RESET');
    io.to(roomCode).emit('ACTIVITY_LOGS_UPDATED', room.logs);
  });

  // 9. UPDATE SCORE
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

  // 10. DISCONNECT CLEANUP
  socket.on('disconnect', () => {
    const { roomCode, teamName, playerName } = socket;
    if (roomCode && rooms[roomCode]) {
      const room = rooms[roomCode];
      
      if (teamName && room.teams[teamName]) {
        room.teams[teamName].members = room.teams[teamName].members.filter((m) => m !== playerName);
        addLog(room, 'PARTICIPANT', `👋 ${playerName} left team "${teamName}" (Disconnected)`);
        
        io.to(roomCode).emit('TEAMS_UPDATED', room.teams);
        io.to(roomCode).emit('ACTIVITY_LOGS_UPDATED', room.logs);
        broadcastAdminUpdate();
      }
    }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
