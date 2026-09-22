const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

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
  if (room.logs.length > 25) room.logs.pop();
  return logItem;
}

function stopRoomTimer(room, roomCode) {
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
    room.timerInterval = null;
  }
  room.timerActive = false;
  io.to(roomCode).emit('TIMER_STOPPED');
}

function startRoomTimer(room, roomCode) {
  if (!room.timerConfig.enabled || room.queue.length === 0) return;

  stopRoomTimer(room, roomCode);

  let timeLeft = room.timerConfig.duration;
  room.timerActive = true;
  const activeTeam = room.queue[0].teamName;

  io.to(roomCode).emit('TIMER_STARTED', { 
    duration: timeLeft, 
    activeTeam 
  });

  room.timerInterval = setInterval(() => {
    timeLeft -= 1;
    io.to(roomCode).emit('TIMER_TICK', { timeLeft });

    if (timeLeft <= 0) {
      stopRoomTimer(room, roomCode);
      const logItem = addLog(room, 'TIMER', `⏰ Time expired for "${activeTeam}"!`);
      io.to(roomCode).emit('TIMER_EXPIRED', { activeTeam });
      io.to(roomCode).emit('NEW_ACTIVITY_LOG', logItem);
    }
  }, 1000);
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
      timerConfig: r.timerConfig
    };
  });
}

function broadcastAdminUpdate() {
  io.to('ADMIN_ROOM').emit('ADMIN_ROOMS_UPDATED', getAdminRoomList());
}

io.on('connection', (socket) => {
  // REJOIN & AUTO-SYNC
  socket.on('REJOIN_ROOM', ({ roomCode, role, teamName, playerName }) => {
    if (role === 'ROOT_ADMIN' || roomCode === '0000') {
      socket.join('ADMIN_ROOM');
      socket.role = 'ROOT_ADMIN';
      socket.playerName = playerName || 'Master Admin';
      return socket.emit('ADMIN_ROOMS_UPDATED', getAdminRoomList());
    }

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
        }
        io.to(roomCode).emit('TEAMS_UPDATED', JSON.parse(JSON.stringify(room.teams)));
      }

      socket.emit('ROOM_SYNCED', {
        roomCode,
        teams: JSON.parse(JSON.stringify(room.teams)),
        queue: room.queue,
        logs: room.logs,
        roundId: room.roundId,
        timerConfig: room.timerConfig
      });
      broadcastAdminUpdate();
    }
  });

  socket.on('FETCH_ADMIN_ROOMS', () => {
    if (socket.role === 'ROOT_ADMIN' || socket.rooms.has('ADMIN_ROOM')) {
      socket.emit('ADMIN_ROOMS_UPDATED', getAdminRoomList());
    }
  });

  // CREATE ROOM
  socket.on('CREATE_ROOM', ({ hostName, hostPassword, participantPassword }) => {
    const roomCode = generateRoomCode();
    
    rooms[roomCode] = {
      roomCode,
      hostName,
      hostPassword,
      participantPassword,
      createdAt: `${new Date().toLocaleDateString()} ${getTimestamp()}`,
      status: 'ACTIVE',
      roundId: 1,
      buzzedTeamsSet: new Set(),
      teams: {},
      queue: [],
      logs: [],
      timerConfig: { enabled: false, duration: 30 },
      timerActive: false,
      timerInterval: null
    };

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.role = 'HOST';
    socket.playerName = hostName;

    addLog(rooms[roomCode], 'ROOM', `Room created by ${hostName}`);
    socket.emit('ROOM_CREATED', { 
      roomCode, 
      logs: rooms[roomCode].logs, 
      roundId: 1,
      timerConfig: rooms[roomCode].timerConfig 
    });
    broadcastAdminUpdate();
  });

  // JOIN AS HOST
  socket.on('JOIN_AS_HOST', ({ roomCode, hostName, hostPassword }) => {
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
      return socket.emit('ERROR', { message: 'Room not found or closed!' });
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
      teams: JSON.parse(JSON.stringify(room.teams)), 
      queue: room.queue, 
      logs: room.logs,
      roundId: room.roundId,
      timerConfig: room.timerConfig 
    });
    broadcastAdminUpdate();
  });

  // JOIN AS PARTICIPANT
  socket.on('JOIN_ROOM_INITIAL', ({ roomCode, playerName, participantPassword }) => {
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

    const logItem = addLog(room, 'PARTICIPANT', `${playerName} joined the room`);
    io.to(roomCode).emit('NEW_ACTIVITY_LOG', logItem);

    socket.emit('JOIN_SUCCESS', { 
      roomCode, 
      teamName: '', 
      teams: JSON.parse(JSON.stringify(room.teams)), 
      logs: room.logs,
      roundId: room.roundId,
      timerConfig: room.timerConfig 
    });
    broadcastAdminUpdate();
  });

  // TIMER CONFIG
  socket.on('UPDATE_TIMER_CONFIG', ({ roomCode, enabled, duration }) => {
    const room = rooms[roomCode];
    if (!room) return;

    room.timerConfig.enabled = Boolean(enabled);
    if (duration && Number(duration) > 0) {
      room.timerConfig.duration = Math.min(300, Math.max(5, Number(duration)));
    }

    if (!room.timerConfig.enabled) {
      stopRoomTimer(room, roomCode);
    }

    const logItem = addLog(room, 'TIMER', `Timer set to ${room.timerConfig.enabled ? `${room.timerConfig.duration}s ON` : 'OFF'}`);
    io.to(roomCode).emit('TIMER_CONFIG_UPDATED', room.timerConfig);
    io.to(roomCode).emit('NEW_ACTIVITY_LOG', logItem);
    broadcastAdminUpdate();
  });

  // TEAMS
  socket.on('CREATE_TEAM', ({ roomCode, teamName }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const cleanTeam = (teamName || '').trim();
    if (!cleanTeam) return;

    if (room.teams[cleanTeam]) return socket.emit('ERROR', { message: 'Team already exists!' });

    room.teams[cleanTeam] = { score: 0, members: [] };
    const logItem = addLog(room, 'TEAM', `New team: "${cleanTeam}"`);
    
    io.to(roomCode).emit('TEAMS_UPDATED', JSON.parse(JSON.stringify(room.teams)));
    io.to(roomCode).emit('NEW_ACTIVITY_LOG', logItem);
    broadcastAdminUpdate();
  });

  socket.on('JOIN_TEAM_SPECIFIC', ({ roomCode, teamName, playerName }) => {
    const room = rooms[roomCode];
    if (!room || !room.teams[teamName]) return socket.emit('ERROR', { message: 'Team does not exist!' });

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.teamName = teamName;
    socket.playerName = playerName;

    // Remove from other teams
    Object.keys(room.teams).forEach((t) => {
      if (Array.isArray(room.teams[t].members)) {
        room.teams[t].members = room.teams[t].members.filter((m) => m !== playerName);
      } else {
        room.teams[t].members = [];
      }
    });

    if (!room.teams[teamName].members.includes(playerName)) {
      room.teams[teamName].members.push(playerName);
    }

    const logItem = addLog(room, 'TEAM', `${playerName} joined "${teamName}"`);
    
    io.to(roomCode).emit('TEAMS_UPDATED', JSON.parse(JSON.stringify(room.teams)));
    io.to(roomCode).emit('NEW_ACTIVITY_LOG', logItem);

    socket.emit('JOIN_SUCCESS', { 
      roomCode, 
      teamName, 
      teams: JSON.parse(JSON.stringify(room.teams)), 
      logs: room.logs,
      roundId: room.roundId,
      timerConfig: room.timerConfig
    });
    broadcastAdminUpdate();
  });

  // HIGH-CONCURRENCY ZERO-DROP BUZZER HANDLER
  socket.on('PRESS_BUZZER', ({ roomCode, teamName, playerName }, ack) => {
    const room = rooms[roomCode];
    if (!room || room.status !== 'ACTIVE') {
      return typeof ack === 'function' && ack({ success: false, reason: 'Inactive room' });
    }

    const cleanTeam = (teamName || '').trim();
    const teamKey = cleanTeam.toLowerCase();
    if (!cleanTeam) {
      return typeof ack === 'function' && ack({ success: false, reason: 'No team specified' });
    }

    // Atomic duplicate check per active round
    if (room.buzzedTeamsSet.has(teamKey)) {
      return typeof ack === 'function' && ack({ success: false, reason: 'Already buzzed' });
    }

    room.buzzedTeamsSet.add(teamKey);
    const newEntry = { teamName: cleanTeam, playerName, timestamp: Date.now() };
    room.queue.push(newEntry);
    const rank = room.queue.length;

    // Single unified queue broadcast
    io.to(roomCode).emit('BUZZER_QUEUE_UPDATED', { queue: room.queue, roundId: room.roundId });

    if (rank === 1) {
      io.to(roomCode).emit('HOST_ACTION_NOTICE', { message: `⚡ Team "${cleanTeam}" buzzed #1!` });
      if (room.timerConfig.enabled) {
        startRoomTimer(room, roomCode);
      }
    }

    if (typeof ack === 'function') ack({ success: true, rank });
  });

  // PASS TO NEXT (RELEASES PASSED TEAM TO REBUZZ)
  socket.on('PASS_TO_NEXT', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.queue.length === 0) return;

    stopRoomTimer(room, roomCode);

    const failed = room.queue.shift();
    if (failed && failed.teamName) {
      // Free this team so they can rebuzz immediately
      room.buzzedTeamsSet.delete(failed.teamName.trim().toLowerCase());
    }

    const logItem = addLog(room, 'BUZZ', `❌ "${failed ? failed.teamName : 'Turn'}" passed!`);

    io.to(roomCode).emit('BUZZER_QUEUE_UPDATED', { queue: room.queue, roundId: room.roundId });
    io.to(roomCode).emit('NEW_ACTIVITY_LOG', logItem);

    if (room.queue.length > 0 && room.timerConfig.enabled) {
      startRoomTimer(room, roomCode);
    }
  });

  // RESET BUZZERS (NEXT QUESTION)
  socket.on('RESET_BUZZER', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;

    stopRoomTimer(room, roomCode);

    room.roundId = (room.roundId || 1) + 1;
    room.buzzedTeamsSet.clear();
    room.queue = [];

    io.to(roomCode).emit('BUZZER_RESET', { roundId: room.roundId });
    io.to(roomCode).emit('BUZZER_QUEUE_UPDATED', { queue: [], roundId: room.roundId });
  });

  // SCORE & NEXT QUESTION
  socket.on('UPDATE_SCORE_AND_NEXT_QUESTION', ({ roomCode, teamName, delta }) => {
    const room = rooms[roomCode];
    if (!room || !room.teams[teamName]) return;

    stopRoomTimer(room, roomCode);

    room.teams[teamName].score += delta;
    room.roundId = (room.roundId || 1) + 1;
    room.buzzedTeamsSet.clear();
    room.queue = [];

    const logItem = addLog(room, 'SCORE', `🏆 "${teamName}" awarded ${delta > 0 ? `+${delta}` : delta} pts!`);

    io.to(roomCode).emit('TEAMS_UPDATED', JSON.parse(JSON.stringify(room.teams)));
    io.to(roomCode).emit('BUZZER_RESET', { roundId: room.roundId });
    io.to(roomCode).emit('BUZZER_QUEUE_UPDATED', { queue: [], roundId: room.roundId });
    io.to(roomCode).emit('NEW_ACTIVITY_LOG', logItem);
  });

  // ROSTER ACTIONS
  socket.on('LEAVE_TEAM', ({ roomCode, teamName, playerName }) => {
    const room = rooms[roomCode];
    if (!room || !room.teams[teamName]) return;

    room.teams[teamName].members = room.teams[teamName].members.filter((m) => m !== playerName);
    socket.teamName = '';

    const logItem = addLog(room, 'TEAM', `👋 ${playerName} left "${teamName}"`);
    io.to(roomCode).emit('TEAMS_UPDATED', JSON.parse(JSON.stringify(room.teams)));
    io.to(roomCode).emit('NEW_ACTIVITY_LOG', logItem);
    broadcastAdminUpdate();
  });

  socket.on('REMOVE_PLAYER', ({ roomCode, teamName, playerName }) => {
    const room = rooms[roomCode];
    if (!room || !room.teams[teamName]) return;

    room.teams[teamName].members = room.teams[teamName].members.filter((m) => m !== playerName);
    const logItem = addLog(room, 'ADMIN', `Removed "${playerName}" from "${teamName}"`);

    io.to(roomCode).emit('TEAMS_UPDATED', JSON.parse(JSON.stringify(room.teams)));
    io.to(roomCode).emit('NEW_ACTIVITY_LOG', logItem);
    io.to(roomCode).emit('PLAYER_REMOVED', { teamName, playerName });
    broadcastAdminUpdate();
  });

  socket.on('REMOVE_TEAM', ({ roomCode, teamName }) => {
    const room = rooms[roomCode];
    if (!room || !room.teams[teamName]) return;

    delete room.teams[teamName];
    room.buzzedTeamsSet.delete(teamName.trim().toLowerCase());
    room.queue = room.queue.filter((i) => i.teamName.trim().toLowerCase() !== teamName.trim().toLowerCase());

    const logItem = addLog(room, 'ADMIN', `Deleted team "${teamName}"`);
    io.to(roomCode).emit('TEAMS_UPDATED', JSON.parse(JSON.stringify(room.teams)));
    io.to(roomCode).emit('BUZZER_QUEUE_UPDATED', { queue: room.queue, roundId: room.roundId });
    io.to(roomCode).emit('NEW_ACTIVITY_LOG', logItem);
    io.to(roomCode).emit('TEAM_REMOVED', { teamName });
    broadcastAdminUpdate();
  });

  socket.on('CLOSE_ROOM', ({ roomCode }) => {
    if (rooms[roomCode]) {
      stopRoomTimer(rooms[roomCode], roomCode);
      rooms[roomCode].status = 'CLOSED';
      io.to(roomCode).emit('KICKED_OUT', { message: 'This room has been terminated.' });
      broadcastAdminUpdate();
    }
  });

  socket.on('disconnect', () => {
    // Preserve team membership across mobile screen dimming
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`v4.3.0 Engine listening on port ${PORT}`);
});
