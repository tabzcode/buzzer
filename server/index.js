const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

// Lightweight health check endpoint to keep server warm
app.get('/health', (req, res) => res.status(200).send('OK'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ['websocket', 'polling'],
  pingTimeout: 30000,
  pingInterval: 10000,
  maxHttpBufferSize: 1e6
});

const rooms = {};

function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function getTimestamp() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function addLog(room, type, message) {
  if (!room.logs) room.logs = [];
  const logItem = { type, message, time: getTimestamp() };
  room.logs.unshift(logItem);
  if (room.logs.length > 30) room.logs.pop();
  return logItem;
}

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
      status: r.status,
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
  // 0. QUICK RECONNECT & SYNC
  socket.on('REJOIN_ROOM', ({ roomCode, role, teamName, playerName }) => {
    const room = rooms[roomCode];
    if (room && room.status === 'ACTIVE') {
      socket.join(roomCode);
      socket.roomCode = roomCode;
      socket.role = role;
      socket.teamName = teamName;
      socket.playerName = playerName;

      if (role === 'PARTICIPANT' && teamName && room.teams[teamName]) {
        if (!room.teams[teamName].members.includes(playerName)) {
          room.teams[teamName].members.push(playerName);
          io.to(roomCode).emit('TEAMS_UPDATED', room.teams);
        }
      }

      socket.emit('ROOM_SYNCED', {
        roomCode,
        teams: room.teams,
        queue: room.queue,
        logs: room.logs,
        roundId: room.roundId
      });
      broadcastAdminUpdate();
    }
  });

  // 1. CREATE ROOM
  socket.on('CREATE_ROOM', ({ hostName, hostPassword, participantPassword, joinMethod }) => {
    const roomCode = generateRoomCode();
    
    rooms[roomCode] = {
      roomCode,
      hostName,
      hostPassword,
      participantPassword,
      joinMethod: joinMethod || 'Manual ID',
      createdAt: `${new Date().toLocaleDateString()} ${getTimestamp()}`,
      status: 'ACTIVE',
      roundId: 1,
      teams: {},
      queue: [],
      logs: []
    };

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.role = 'HOST';
    socket.playerName = hostName;

    addLog(rooms[roomCode], 'ROOM', `Room created by ${hostName}`);
    socket.emit('ROOM_CREATED', { roomCode, logs: rooms[roomCode].logs, roundId: 1 });
    broadcastAdminUpdate();
  });

  // 2. JOIN AS HOST / ROOT ADMIN CHECK
  socket.on('JOIN_AS_HOST', ({ roomCode, hostName, hostPassword, joinMethod }) => {
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
      return socket.emit('ERROR', { message: 'Room not found or is closed!' });
    }

    if (room.hostPassword !== hostPassword && hostPassword !== '9676') {
      return socket.emit('ERROR', { message: 'Incorrect Host Password!' });
    }

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.role = 'HOST';
    socket.playerName = hostName;

    const logItem = addLog(room, 'HOST', `${hostName} joined as Co-Host`);
    io.to(roomCode).emit('NEW_ACTIVITY_LOG', logItem);

    socket.emit('HOST_JOIN_SUCCESS', { 
      roomCode, 
      teams: room.teams, 
      queue: room.queue, 
      logs: room.logs,
      roundId: room.roundId 
    });
    broadcastAdminUpdate();
  });

  // 3. JOIN AS PARTICIPANT
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

    const logItem = addLog(room, 'PARTICIPANT', `${playerName} entered room`);
    io.to(roomCode).emit('NEW_ACTIVITY_LOG', logItem);

    socket.emit('JOIN_SUCCESS', { 
      roomCode, 
      teamName: '', 
      teams: room.teams, 
      logs: room.logs,
      roundId: room.roundId 
    });
    broadcastAdminUpdate();
  });

  // 4. CREATE TEAM
  socket.on('CREATE_TEAM', ({ roomCode, teamName }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const cleanTeam = teamName.trim();
    if (room.teams[cleanTeam]) return socket.emit('ERROR', { message: 'Team already exists!' });

    room.teams[cleanTeam] = { score: 0, members: [] };
    const logItem = addLog(room, 'TEAM', `New team created: "${cleanTeam}"`);
    
    io.to(roomCode).emit('TEAMS_UPDATED', room.teams);
    io.to(roomCode).emit('NEW_ACTIVITY_LOG', logItem);
    broadcastAdminUpdate();
  });

  // 5. JOIN TEAM
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

    const logItem = addLog(room, 'TEAM', `${playerName} joined "${teamName}"`);

    io.to(roomCode).emit('TEAMS_UPDATED', room.teams);
    io.to(roomCode).emit('NEW_ACTIVITY_LOG', logItem);

    socket.emit('JOIN_SUCCESS', { 
      roomCode, 
      teamName, 
      teams: room.teams, 
      logs: room.logs,
      roundId: room.roundId 
    });
    broadcastAdminUpdate();
  });

  // 6. ULTRA-FAST LEAN BUZZ HANDLER (<100 BYTES PAYLOAD)
  socket.on('PRESS_BUZZER', ({ roomCode, teamName, playerName, roundId }, ack) => {
    const room = rooms[roomCode];
    if (!room || room.status !== 'ACTIVE') {
      if (typeof ack === 'function') ack({ success: false, reason: 'Inactive room' });
      return;
    }

    if (roundId !== room.roundId) {
      if (typeof ack === 'function') ack({ success: false, reason: 'Stale round' });
      return;
    }

    const alreadyBuzzed = room.queue.some((item) => item.teamName === teamName);
    if (alreadyBuzzed) {
      if (typeof ack === 'function') ack({ success: false, reason: 'Already buzzed' });
      return;
    }

    // Atomic push to in-memory queue
    room.queue.push({
      teamName,
      playerName,
      timestamp: Date.now()
    });

    const rank = room.queue.length;
    addLog(room, 'BUZZ', `⚡ ${teamName} (${playerName}) buzzed in #${rank}!`);

    // Broadcast ONLY queue and roundId (eliminates network choke across 100+ devices)
    io.to(roomCode).emit('BUZZER_QUEUE_UPDATED', { queue: room.queue, roundId: room.roundId });

    if (rank === 1) {
      io.to(roomCode).emit('HOST_ACTION_NOTICE', { message: `⚡ Team "${teamName}" buzzed FIRST (#1)!` });
    }

    if (typeof ack === 'function') ack({ success: true, rank });
  });

  // 7. RESET BUZZERS (INCREMENTS ROUND ID)
  socket.on('RESET_BUZZER', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;

    room.roundId = (room.roundId || 1) + 1;
    room.queue = [];
    const logItem = addLog(room, 'BUZZ', `Buzzers reset for Round #${room.roundId}`);

    io.to(roomCode).emit('BUZZER_RESET', { roundId: room.roundId });
    io.to(roomCode).emit('NEW_ACTIVITY_LOG', logItem);
  });

  // 8. UPDATE SCORE & NEXT QUESTION
  socket.on('UPDATE_SCORE_AND_NEXT_QUESTION', ({ roomCode, teamName, delta }) => {
    const room = rooms[roomCode];
    if (!room || !room.teams[teamName]) return;

    room.teams[teamName].score += delta;
    room.roundId = (room.roundId || 1) + 1;
    room.queue = [];

    const logItem = addLog(room, 'SCORE', `🏆 "${teamName}" awarded ${delta > 0 ? `+${delta}` : delta} pts!`);

    io.to(roomCode).emit('TEAMS_UPDATED', room.teams);
    io.to(roomCode).emit('BUZZER_RESET', { roundId: room.roundId });
    io.to(roomCode).emit('NEW_ACTIVITY_LOG', logItem);
  });

  // 9. PASS TO NEXT
  socket.on('PASS_TO_NEXT', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.queue.length === 0) return;

    const failed = room.queue.shift();
    const logItem = addLog(room, 'BUZZ', `❌ "${failed.teamName}" skipped. Passed to next!`);

    io.to(roomCode).emit('BUZZER_QUEUE_UPDATED', { queue: room.queue, roundId: room.roundId });
    io.to(roomCode).emit('NEW_ACTIVITY_LOG', logItem);
  });

  // 10. LEAVE TEAM
  socket.on('LEAVE_TEAM', ({ roomCode, teamName, playerName }) => {
    const room = rooms[roomCode];
    if (!room || !room.teams[teamName]) return;

    room.teams[teamName].members = room.teams[teamName].members.filter((m) => m !== playerName);
    socket.teamName = '';

    const logItem = addLog(room, 'TEAM', `👋 ${playerName} left team "${teamName}"`);

    io.to(roomCode).emit('TEAMS_UPDATED', room.teams);
    io.to(roomCode).emit('NEW_ACTIVITY_LOG', logItem);
    broadcastAdminUpdate();
  });

  // 11. REMOVE PLAYER
  socket.on('REMOVE_PLAYER', ({ roomCode, teamName, playerName }) => {
    const room = rooms[roomCode];
    if (!room || !room.teams[teamName]) return;

    room.teams[teamName].members = room.teams[teamName].members.filter((m) => m !== playerName);
    const logItem = addLog(room, 'ADMIN', `Host removed "${playerName}" from "${teamName}"`);

    io.to(roomCode).emit('TEAMS_UPDATED', room.teams);
    io.to(roomCode).emit('NEW_ACTIVITY_LOG', logItem);
    io.to(roomCode).emit('PLAYER_REMOVED', { teamName, playerName });
    broadcastAdminUpdate();
  });

  // 12. REMOVE TEAM
  socket.on('REMOVE_TEAM', ({ roomCode, teamName }) => {
    const room = rooms[roomCode];
    if (!room || !room.teams[teamName]) return;

    delete room.teams[teamName];
    room.queue = room.queue.filter((i) => i.teamName !== teamName);

    const logItem = addLog(room, 'ADMIN', `Host deleted team "${teamName}"`);

    io.to(roomCode).emit('TEAMS_UPDATED', room.teams);
    io.to(roomCode).emit('BUZZER_QUEUE_UPDATED', { queue: room.queue, roundId: room.roundId });
    io.to(roomCode).emit('NEW_ACTIVITY_LOG', logItem);
    io.to(roomCode).emit('TEAM_REMOVED', { teamName });
    broadcastAdminUpdate();
  });

  // 13. CLOSE ROOM (ROOT ADMIN)
  socket.on('CLOSE_ROOM', ({ roomCode }) => {
    if (rooms[roomCode]) {
      rooms[roomCode].status = 'CLOSED';
      addLog(rooms[roomCode], 'ROOM', 'Room closed by Administrator.');
      
      io.to(roomCode).emit('KICKED_OUT', { message: 'This room has been closed by the Root Administrator.' });
      broadcastAdminUpdate();
    }
  });

  // 14. DISCONNECT CLEANUP
  socket.on('disconnect', () => {
    const { roomCode, teamName, playerName } = socket;
    if (roomCode && rooms[roomCode]) {
      const room = rooms[roomCode];
      if (teamName && room.teams[teamName]) {
        room.teams[teamName].members = room.teams[teamName].members.filter((m) => m !== playerName);
        const logItem = addLog(room, 'PARTICIPANT', `👋 ${playerName} disconnected`);
        
        io.to(roomCode).emit('TEAMS_UPDATED', room.teams);
        io.to(roomCode).emit('NEW_ACTIVITY_LOG', logItem);
        broadcastAdminUpdate();
      }
    }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`High-concurrency buzzer server running on port ${PORT}`);
});
