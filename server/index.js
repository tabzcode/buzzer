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
  if (!room.timerConfig || !room.timerConfig.enabled || room.queue.length === 0) return;

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

      // Auto-pass the timed-out team
      const timedOutEntry = room.queue.shift();
      const timedOutTeam = timedOutEntry ? timedOutEntry.teamName : activeTeam;

      if (timedOutTeam) {
        room.buzzedTeamsSet.delete(timedOutTeam.trim().toLowerCase());
      }

      const logItem = addLog(room, 'TIMER', `⏰ Time up for "${timedOutTeam}"!`);

      // Broadcast expiration, queue release, and passed turn
      io.to(roomCode).emit('TIMER_EXPIRED', { activeTeam: timedOutTeam });
      io.to(roomCode).emit('TEAM_PASSED', { 
        passedTeam: timedOutTeam, 
        queue: room.queue 
      });
      io.to(roomCode).emit('BUZZER_QUEUE_UPDATED', { 
        queue: room.queue, 
        roundId: room.roundId 
      });
      io.to(roomCode).emit('NEW_ACTIVITY_LOG', logItem);

      // If next team is in queue, begin their timer
      if (room.queue.length > 0 && room.timerConfig && room.timerConfig.enabled) {
        startRoomTimer(room, roomCode);
      }
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
  // AUTO RECONNECT / WAKE SYNC
  socket.on('REJOIN_ROOM', ({ roomCode, role, teamName, playerName }) => {
    if (role === 'ROOT_ADMIN' || roomCode === '0000') {
      socket.join('ADMIN_ROOM');
      socket.role = 'ROOT_ADMIN';
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
        const cleanName = (playerName || 'Player').trim();
        const exists = room.teams[teamName].members.some(
          m => (typeof m === 'object' ? m.id === socket.id : m === cleanName)
        );
        if (!exists) {
          room.teams[teamName].members.push({ id: socket.id, name: cleanName });
        }
        io.to(roomCode).emit('TEAMS_UPDATED', JSON.parse(JSON.stringify(room.teams)));
      }

      socket.emit('ROOM_SYNCED', {
        roomCode,
        teams: room.teams,
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

  // 1. CREATE ROOM
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

  // 2. JOIN AS HOST
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
      teams: room.teams, 
      queue: room.queue, 
      logs: room.logs,
      roundId: room.roundId,
      timerConfig: room.timerConfig 
    });
    broadcastAdminUpdate();
  });

  // 3. JOIN AS PARTICIPANT
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
      teams: room.teams, 
      logs: room.logs,
      roundId: room.roundId,
      timerConfig: room.timerConfig 
    });
    broadcastAdminUpdate();
  });

  // 4. TIMER CONFIG
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

  // 5. TEAMS CREATION & MEMBER MANAGEMENT
  socket.on('CREATE_TEAM', ({ roomCode, teamName }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const cleanTeam = teamName.trim();
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

    const cleanName = (playerName || 'Player').trim();

    Object.keys(room.teams).forEach((t) => {
      if (Array.isArray(room.teams[t].members)) {
        room.teams[t].members = room.teams[t].members.filter(m => {
          if (typeof m === 'object' && m !== null) return m.id !== socket.id;
          return m !== cleanName;
        });
      } else {
        room.teams[t].members = [];
      }
    });

    room.teams[teamName].members.push({ id: socket.id, name: cleanName });

    const logItem = addLog(room, 'TEAM', `${cleanName} joined "${teamName}"`);
    
    io.to(roomCode).emit('TEAMS_UPDATED', JSON.parse(JSON.stringify(room.teams)));
    io.to(roomCode).emit('NEW_ACTIVITY_LOG', logItem);

    socket.emit('JOIN_SUCCESS', { 
      roomCode, 
      teamName, 
      teams: room.teams, 
      logs: room.logs,
      roundId: room.roundId,
      timerConfig: room.timerConfig
    });
    broadcastAdminUpdate();
  });

  // 6. BUZZ HANDLER
  socket.on('PRESS_BUZZER', ({ roomCode, teamName, playerName }, ack) => {
    const room = rooms[roomCode];
    if (!room || room.status !== 'ACTIVE') {
      return typeof ack === 'function' && ack({ success: false, reason: 'Inactive room' });
    }

    socket.join(roomCode);

    const cleanTeam = (teamName || '').trim();
    if (!cleanTeam) {
      return typeof ack === 'function' && ack({ success: false, reason: 'No team specified' });
    }

    const teamKey = cleanTeam.toLowerCase();

    if (room.buzzedTeamsSet.has(teamKey)) {
      return typeof ack === 'function' && ack({ success: false, reason: 'Already buzzed' });
    }

    room.buzzedTeamsSet.add(teamKey);
    const newEntry = { teamName: cleanTeam, playerName: (playerName || 'Player').trim(), timestamp: Date.now() };
    room.queue.push(newEntry);
    const rank = room.queue.length;

    io.to(roomCode).emit('BUZZER_QUEUE_UPDATED', { 
      queue: room.queue, 
      roundId: room.roundId,
      justBuzzed: cleanTeam,
      buzzerRank: rank
    });

    if (rank === 1) {
      io.to(roomCode).emit('HOST_ACTION_NOTICE', { message: `⚡ Team "${cleanTeam}" buzzed #1!` });
      if (room.timerConfig && room.timerConfig.enabled) {
        startRoomTimer(room, roomCode);
      }
    }

    if (typeof ack === 'function') ack({ success: true, rank, teamName: cleanTeam });
  });

  // 7. PASS TO NEXT
  socket.on('PASS_TO_NEXT', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.queue.length === 0) return;

    stopRoomTimer(room, roomCode);

    const failed = room.queue.shift();
    const passedTeamName = failed ? failed.teamName : '';
    
    if (passedTeamName) {
      room.buzzedTeamsSet.delete(passedTeamName.trim().toLowerCase());
    }

    const logItem = addLog(room, 'BUZZ', `❌ "${passedTeamName || 'Turn'}" passed!`);

    io.to(roomCode).emit('TEAM_PASSED', { 
      passedTeam: passedTeamName, 
      queue: room.queue 
    });
    
    io.to(roomCode).emit('BUZZER_QUEUE_UPDATED', { 
      queue: room.queue, 
      roundId: room.roundId 
    });
    
    io.to(roomCode).emit('NEW_ACTIVITY_LOG', logItem);

    if (room.queue.length > 0 && room.timerConfig && room.timerConfig.enabled) {
      startRoomTimer(room, roomCode);
    }
  });

  // 8. RESET BUZZERS
  socket.on('RESET_BUZZER', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;

    stopRoomTimer(room, roomCode);

    room.roundId = (room.roundId || 1) + 1;
    room.buzzedTeamsSet.clear();
    room.queue = [];

    io.to(roomCode).emit('BUZZER_RESET', { roundId: room.roundId });
  });

  // 9. SCORE ADJUSTMENT
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
    io.to(roomCode).emit('NEW_ACTIVITY_LOG', logItem);
  });

  // 10. ROSTER MANAGEMENT
  socket.on('LEAVE_TEAM', ({ roomCode, teamName, playerName }) => {
    const room = rooms[roomCode];
    if (!room || !room.teams[teamName]) return;

    const cleanName = (playerName || '').trim();
    room.teams[teamName].members = room.teams[teamName].members.filter(m => {
      if (typeof m === 'object' && m !== null) return m.id !== socket.id;
      return m !== cleanName;
    });
    socket.teamName = '';

    const logItem = addLog(room, 'TEAM', `👋 ${cleanName || 'Player'} left "${teamName}"`);
    io.to(roomCode).emit('TEAMS_UPDATED', JSON.parse(JSON.stringify(room.teams)));
    io.to(roomCode).emit('NEW_ACTIVITY_LOG', logItem);
    broadcastAdminUpdate();
  });

  socket.on('REMOVE_PLAYER', ({ roomCode, teamName, playerName }) => {
    const room = rooms[roomCode];
    if (!room || !room.teams[teamName]) return;

    const cleanName = (playerName || '').trim();
    room.teams[teamName].members = room.teams[teamName].members.filter(m => {
      const name = typeof m === 'object' ? m.name : m;
      return name !== cleanName;
    });

    const logItem = addLog(room, 'ADMIN', `Removed "${cleanName}" from "${teamName}"`);

    io.to(roomCode).emit('TEAMS_UPDATED', JSON.parse(JSON.stringify(room.teams)));
    io.to(roomCode).emit('NEW_ACTIVITY_LOG', logItem);
    io.to(roomCode).emit('PLAYER_REMOVED', { teamName, playerName: cleanName });
    broadcastAdminUpdate();
  });

  socket.on('REMOVE_TEAM', ({ roomCode, teamName }) => {
    const room = rooms[roomCode];
    if (!room || !room.teams[teamName]) return;

    delete room.teams[teamName];
    room.buzzedTeamsSet.delete(teamName.trim().toLowerCase());
    room.queue = room.queue.filter((i) => i.teamName !== teamName);

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

  socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`v4.4.0 Engine listening on port ${PORT}`);
});
