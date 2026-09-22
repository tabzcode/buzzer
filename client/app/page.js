'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';
import { 
  Shield, Users, RotateCcw, CheckCircle2, XCircle, Sparkles, Volume2, Trophy, 
  Lock, Check, UserMinus, Trash2, ChevronDown, ChevronUp, AlertTriangle, 
  LogOut, Info, KeyRound, Plus, UserPlus, Activity, ArrowLeft, Server, 
  PlusCircle, MinusCircle, WifiOff, Clock, Timer 
} from 'lucide-react';

const SOCKET_URL = "https://buzzer-n9va.onrender.com";
const APP_VERSION = "v4.4.0";

let audioCtx = null;
const initAudio = () => {
  if (typeof window === 'undefined') return;
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
};

const playSound = (type) => {
  try {
    initAudio();
    if (!audioCtx) return;

    const osc = audioCtx.createGain ? audioCtx.createOscillator() : null;
    const gain = audioCtx.createGain ? audioCtx.createGain() : null;
    if (!osc || !gain) return;

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'BUZZ') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.35, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.25);
    } else if (type === 'CORRECT') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, audioCtx.currentTime);
      osc.frequency.setValueAtTime(659.25, audioCtx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.28);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.28);
    } else if (type === 'WRONG' || type === 'TIMEOUT') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(220, audioCtx.currentTime);
      osc.frequency.setValueAtTime(110, audioCtx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.35);
    } else if (type === 'TICK') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.04, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.04);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.04);
    }
  } catch (e) {
    console.error("Audio error:", e);
  }
};

export default function App() {
  const [screen, setScreen] = useState('LANDING');
  const [role, setRole] = useState(null);
  const [roomCode, setRoomCode] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  
  // Forms
  const [hostName, setHostName] = useState('');
  const [hostPassword, setHostPassword] = useState('');
  const [participantPassword, setParticipantPassword] = useState('');
  const [enteredRoomCode, setEnteredRoomCode] = useState('');
  const [enteredName, setEnteredName] = useState('');
  const [enteredPassword, setEnteredPassword] = useState('');
  const [newTeamName, setNewTeamName] = useState('');

  // Game Data
  const [teams, setTeams] = useState({});
  const [queue, setQueue] = useState([]);
  const [activityLogs, setActivityLogs] = useState([]);
  const [expandedTeams, setExpandedTeams] = useState({});
  const [membersModalTeam, setMembersModalTeam] = useState(null);
  const [adminRoomsList, setAdminRoomsList] = useState([]);
  const [roundId, setRoundId] = useState(1);
  const [hasBuzzedState, setHasBuzzedState] = useState(false);
  
  // Timer
  const [timerConfig, setTimerConfig] = useState({ enabled: false, duration: 30 });
  const [timerLeft, setTimerLeft] = useState(null);
  const [isTimerActive, setIsTimerActive] = useState(false);
  const [timerActiveTeam, setTimerActiveTeam] = useState('');
  
  // Modals & Banners
  const [confirmModal, setConfirmModal] = useState({ open: false, type: '', teamName: '', playerName: '' });
  const [kickedNotice, setKickedNotice] = useState('');
  const [toastMessage, setToastMessage] = useState('');

  const socketRef = useRef(null);
  const teamRef = useRef('');
  const playerRef = useRef('');
  const roleRef = useRef(role);
  const roomCodeRef = useRef(roomCode);
  const buzzedLockRef = useRef(false);

  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  useEffect(() => {
    roomCodeRef.current = roomCode;
  }, [roomCode]);

  useEffect(() => {
    const handleWarm = () => initAudio();
    window.addEventListener('touchstart', handleWarm, { once: true, passive: true });
    window.addEventListener('click', handleWarm, { once: true, passive: true });
    return () => {
      window.removeEventListener('touchstart', handleWarm);
      window.removeEventListener('click', handleWarm);
    };
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const qRoom = params.get('room');
      if (qRoom) setEnteredRoomCode(qRoom);

      try {
        const savedSession = sessionStorage.getItem('bp_session');
        if (savedSession) {
          const parsed = JSON.parse(savedSession);
          if (parsed.roomCode && parsed.role) {
            setRoomCode(parsed.roomCode);
            roomCodeRef.current = parsed.roomCode;
            setRole(parsed.role);
            roleRef.current = parsed.role;
            setEnteredName(parsed.playerName || '');
            playerRef.current = parsed.playerName || '';
            teamRef.current = parsed.teamName || '';
            setScreen('GAME');
          }
        }
      } catch (err) {
        console.error("Session parse error:", err);
      }
    }
  }, []);

  const saveSession = (rCode, rRole, tName, pName) => {
    try {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('bp_session', JSON.stringify({
          roomCode: rCode,
          role: rRole,
          teamName: tName || '',
          playerName: pName || ''
        }));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const clearSession = () => {
    try {
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('bp_session');
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    socketRef.current = io(SOCKET_URL, { 
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 400,
      reconnectionDelayMax: 1500,
      timeout: 10000
    });

    const socket = socketRef.current;

    socket.on('connect', () => {
      setIsConnected(true);
      if (roomCodeRef.current && roleRef.current) {
        socket.emit('REJOIN_ROOM', {
          roomCode: roomCodeRef.current,
          role: roleRef.current,
          teamName: teamRef.current,
          playerName: playerRef.current
        });
      }
    });

    socket.on('disconnect', () => setIsConnected(false));

    socket.on('ROOM_SYNCED', ({ roomCode: syncedRoom, teams: syncedTeams, queue: syncedQueue, logs: syncedLogs, roundId: rId, timerConfig: tConf }) => {
      setRoomCode(syncedRoom);
      setTeams({ ...(syncedTeams || {}) });
      setQueue(syncedQueue || []);
      if (syncedLogs) setActivityLogs(syncedLogs);
      if (rId) setRoundId(rId);
      if (tConf) setTimerConfig(tConf);
      
      const isBuzzed = (syncedQueue || []).some(
        item => (item.teamName || '').trim().toLowerCase() === (teamRef.current || '').trim().toLowerCase()
      );
      buzzedLockRef.current = isBuzzed;
      setHasBuzzedState(isBuzzed);
    });

    socket.on('ROOM_CREATED', ({ roomCode: rCode, logs, roundId: rId, timerConfig: tConf }) => {
      setRoomCode(rCode);
      setEnteredName(hostName);
      playerRef.current = hostName;
      setRole('HOST');
      setScreen('GAME');
      saveSession(rCode, 'HOST', '', hostName);
      if (logs) setActivityLogs(logs);
      if (rId) setRoundId(rId);
      if (tConf) setTimerConfig(tConf);
    });

    socket.on('HOST_JOIN_SUCCESS', ({ roomCode: rCode, teams: t, queue: q, logs, roundId: rId, timerConfig: tConf }) => {
      setRoomCode(rCode);
      setTeams({ ...(t || {}) });
      setQueue(q || []);
      setRole('HOST');
      setScreen('GAME');
      saveSession(rCode, 'HOST', '', playerRef.current);
      if (logs) setActivityLogs(logs);
      if (rId) setRoundId(rId);
      if (tConf) setTimerConfig(tConf);
    });

    socket.on('JOIN_SUCCESS', ({ roomCode: joinedRoom, teamName: joinedTeam, teams: t, logs, roundId: rId, timerConfig: tConf }) => {
      setRoomCode(joinedRoom);
      if (joinedTeam) {
        teamRef.current = joinedTeam;
        buzzedLockRef.current = false;
        setHasBuzzedState(false);
      }
      setTeams({ ...(t || {}) });
      setRole('PARTICIPANT');
      setScreen('GAME');
      saveSession(joinedRoom, 'PARTICIPANT', joinedTeam || teamRef.current, playerRef.current);
      if (logs) setActivityLogs(logs);
      if (rId) setRoundId(rId);
      if (tConf) setTimerConfig(tConf);
    });

    socket.on('ADMIN_LOGIN_SUCCESS', ({ adminName, roomsList }) => {
      setRole('ROOT_ADMIN');
      setEnteredName(adminName);
      setAdminRoomsList(roomsList || []);
      setScreen('ADMIN_DASHBOARD');
    });

    socket.on('ADMIN_ROOMS_UPDATED', (roomsList) => {
      setAdminRoomsList(roomsList || []);
    });

    socket.on('ERROR', ({ message }) => alert(message));
    
    socket.on('TEAMS_UPDATED', (updatedTeams) => {
      setTeams({ ...updatedTeams });
    });

    socket.on('BUZZER_QUEUE_UPDATED', ({ queue: updatedQueue, roundId: currentRId, justBuzzed, buzzerRank }) => {
      setQueue(updatedQueue || []);
      if (currentRId) setRoundId(currentRId);

      const isMyTeamInQueue = (updatedQueue || []).some(
        item => (item.teamName || '').trim().toLowerCase() === (teamRef.current || '').trim().toLowerCase()
      );
      buzzedLockRef.current = isMyTeamInQueue;
      setHasBuzzedState(isMyTeamInQueue);

      if (buzzerRank === 1 || (updatedQueue && updatedQueue.length === 1)) {
        playSound('BUZZ');
      }
    });

    socket.on('TEAM_PASSED', ({ passedTeam, queue: newQueue }) => {
      setQueue(newQueue || []);
      const myTeam = (teamRef.current || '').trim().toLowerCase();
      const targetPassed = (passedTeam || '').trim().toLowerCase();

      if (myTeam && myTeam === targetPassed) {
        buzzedLockRef.current = false;
        setHasBuzzedState(false);
        playSound('WRONG');
        setToastMessage("Turn passed! Your team can buzz again now.");
        setTimeout(() => setToastMessage(''), 3000);
      }
    });

    socket.on('BUZZER_RESET', ({ roundId: nextRoundId }) => {
      setQueue([]);
      buzzedLockRef.current = false;
      setHasBuzzedState(false);
      setIsTimerActive(false);
      setTimerLeft(null);
      if (nextRoundId) setRoundId(nextRoundId);
    });

    socket.on('TIMER_CONFIG_UPDATED', (conf) => setTimerConfig(conf));

    socket.on('TIMER_STARTED', ({ duration, activeTeam }) => {
      setIsTimerActive(true);
      setTimerLeft(duration);
      setTimerActiveTeam(activeTeam);
    });

    socket.on('TIMER_TICK', ({ timeLeft }) => {
      setTimerLeft(timeLeft);
      if (timeLeft <= 5 && timeLeft > 0) playSound('TICK');
    });

    // TIME'S UP HANDLER: Turns green button back to red
    socket.on('TIMER_EXPIRED', ({ activeTeam }) => {
      setIsTimerActive(true);
      setTimerLeft(0);
      playSound('TIMEOUT');
      setToastMessage(`⏰ TIME UP for "${activeTeam}"!`);

      // Immediately unlock the timed-out team and return button to red
      const myTeam = (teamRef.current || '').trim().toLowerCase();
      if (myTeam && myTeam === (activeTeam || '').trim().toLowerCase()) {
        buzzedLockRef.current = false;
        setHasBuzzedState(false);
      }

      setTimeout(() => {
        setIsTimerActive(false);
        setTimerLeft(null);
        setToastMessage('');
      }, 3000);
    });

    socket.on('TIMER_STOPPED', () => {
      setIsTimerActive(false);
      setTimerLeft(null);
    });

    socket.on('NEW_ACTIVITY_LOG', (logItem) => {
      setActivityLogs((prev) => [logItem, ...prev.slice(0, 24)]);
    });

    socket.on('HOST_ACTION_NOTICE', ({ message }) => {
      setToastMessage(message);
      setTimeout(() => setToastMessage(''), 3500);
    });

    socket.on('TEAM_REMOVED', ({ teamName: removedTeam }) => {
      if (roleRef.current === 'PARTICIPANT' && teamRef.current === removedTeam) {
        clearSession();
        setKickedNotice('Host removed your team.');
        setScreen('LANDING');
        setRole(null);
        teamRef.current = '';
        buzzedLockRef.current = false;
        setHasBuzzedState(false);
      }
    });

    socket.on('PLAYER_REMOVED', ({ teamName: tName, playerName: pName }) => {
      if (roleRef.current === 'PARTICIPANT' && teamRef.current === tName && playerRef.current === pName) {
        clearSession();
        setKickedNotice('Host removed you from the team.');
        setScreen('LANDING');
        setRole(null);
        teamRef.current = '';
        buzzedLockRef.current = false;
        setHasBuzzedState(false);
      }
    });

    socket.on('KICKED_OUT', ({ message }) => {
      clearSession();
      setKickedNotice(message);
      setScreen('LANDING');
      setRole(null);
      teamRef.current = '';
      buzzedLockRef.current = false;
      setHasBuzzedState(false);
    });

    return () => {
      if (socket) socket.disconnect();
    };
  }, [hostName]);

  const handleCreateRoomSubmit = (e) => {
    e.preventDefault();
    if (!hostName || !hostPassword || !participantPassword) return alert('Please fill all fields!');
    if (hostPassword.length !== 4 || participantPassword.length !== 4) {
      return alert('Passwords must be 4 characters!');
    }
    if (hostPassword === participantPassword) {
      return alert('Host and Player passwords cannot be identical!');
    }
    playerRef.current = hostName;
    socketRef.current.emit('CREATE_ROOM', { hostName, hostPassword, participantPassword });
  };

  const handleJoinHostSubmit = (e) => {
    e.preventDefault();
    const targetRoom = enteredRoomCode.trim();
    if (!targetRoom || !enteredPassword) return alert('Please enter room code and password!');
    
    playerRef.current = enteredName || 'Host';
    socketRef.current.emit('JOIN_AS_HOST', { 
      roomCode: targetRoom, 
      hostName: enteredName || 'Host', 
      hostPassword: enteredPassword
    });
  };

  const handleJoinParticipantSubmit = (e) => {
    e.preventDefault();
    const targetRoom = enteredRoomCode.trim();
    if (!targetRoom || !enteredName || !enteredPassword) return alert('Please fill all fields!');
    
    playerRef.current = enteredName.trim();
    socketRef.current.emit('JOIN_ROOM_INITIAL', { 
      roomCode: targetRoom, 
      playerName: enteredName.trim(), 
      participantPassword: enteredPassword
    });
  };

  const handleToggleTimer = () => {
    if (!socketRef.current) return;
    socketRef.current.emit('UPDATE_TIMER_CONFIG', {
      roomCode,
      enabled: !timerConfig.enabled,
      duration: timerConfig.duration
    });
  };

  const handleSetTimerDuration = (duration) => {
    if (!socketRef.current) return;
    socketRef.current.emit('UPDATE_TIMER_CONFIG', {
      roomCode,
      enabled: timerConfig.enabled,
      duration: Number(duration)
    });
  };

  const handleRefreshAdminRooms = () => {
    if (socketRef.current) {
      socketRef.current.emit('FETCH_ADMIN_ROOMS');
    }
  };

  const handleCreateTeam = (e) => {
    e.preventDefault();
    if (!newTeamName.trim()) return;
    socketRef.current.emit('CREATE_TEAM', { roomCode, teamName: newTeamName.trim() });
    setNewTeamName('');
  };

  const handleJoinTeam = (targetTeamName) => {
    teamRef.current = targetTeamName;
    buzzedLockRef.current = false;
    setHasBuzzedState(false);
    saveSession(roomCode, 'PARTICIPANT', targetTeamName, playerRef.current || enteredName);
    socketRef.current.emit('JOIN_TEAM_SPECIFIC', { 
      roomCode, 
      teamName: targetTeamName, 
      playerName: playerRef.current || enteredName || 'Player' 
    });
  };

  const handleLeaveTeam = () => {
    if (socketRef.current && teamRef.current) {
      socketRef.current.emit('LEAVE_TEAM', { 
        roomCode, 
        teamName: teamRef.current, 
        playerName: playerRef.current || enteredName 
      });
      teamRef.current = '';
      buzzedLockRef.current = false;
      setHasBuzzedState(false);
      saveSession(roomCode, 'PARTICIPANT', '', playerRef.current || enteredName);
      setTeams((prev) => ({ ...prev }));
    }
  };

  const handleLeaveRoom = () => {
    if (window.confirm("Exit this room?")) {
      clearSession();
      setScreen('LANDING');
      setRole(null);
      setRoomCode('');
      teamRef.current = '';
      playerRef.current = '';
      buzzedLockRef.current = false;
      setHasBuzzedState(false);
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current.connect();
      }
    }
  };

  const toggleTeamExpand = (tName) => {
    setExpandedTeams((prev) => ({ ...prev, [tName]: !prev[tName] }));
  };

  const handleScoreChange = (tName, delta) => {
    if (!socketRef.current) return;
    socketRef.current.emit('UPDATE_SCORE_AND_NEXT_QUESTION', { roomCode, teamName: tName, delta });
  };

  const myTeamQueueIndex = queue.findIndex(
    (item) => (item.teamName || '').trim().toLowerCase() === (teamRef.current || '').trim().toLowerCase()
  );
  
  const isBuzzedConfirmed = myTeamQueueIndex !== -1 || hasBuzzedState;
  const myRank = myTeamQueueIndex !== -1 ? myTeamQueueIndex + 1 : (hasBuzzedState ? '1' : null);

  const handleBuzz = useCallback((e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (buzzedLockRef.current || isBuzzedConfirmed || !socketRef.current || !teamRef.current) {
      return;
    }

    buzzedLockRef.current = true;
    setHasBuzzedState(true);

    if (navigator.vibrate) navigator.vibrate(60);

    socketRef.current.emit('PRESS_BUZZER', { 
      roomCode, 
      teamName: teamRef.current, 
      playerName: playerRef.current || enteredName || 'Player'
    }, (ack) => {
      if (!ack || !ack.success) {
        if (ack && ack.reason === 'Already buzzed') {
          buzzedLockRef.current = true;
          setHasBuzzedState(true);
        } else {
          buzzedLockRef.current = false;
          setHasBuzzedState(false);
        }
      }
    });
  }, [isBuzzedConfirmed, roomCode, enteredName]);

  const confirmAction = () => {
    if (!socketRef.current) return;
    if (confirmModal.type === 'PLAYER') {
      socketRef.current.emit('REMOVE_PLAYER', { roomCode, teamName: confirmModal.teamName, playerName: confirmModal.playerName });
    } else if (confirmModal.type === 'TEAM') {
      socketRef.current.emit('REMOVE_TEAM', { roomCode, teamName: confirmModal.teamName });
    }
    setConfirmModal({ open: false, type: '', teamName: '', playerName: '' });
  };

  const handleTerminateRoom = (targetCode) => {
    if (confirm(`Terminate Room #${targetCode}?`)) {
      socketRef.current.emit('CLOSE_ROOM', { roomCode: targetCode });
    }
  };

  const getQrUrl = () => {
    if (typeof window !== 'undefined') {
      return `${window.location.origin}?room=${roomCode}`;
    }
    return roomCode;
  };

  const getMemberName = (m) => {
    if (typeof m === 'object' && m !== null) return m.name || 'Player';
    return String(m);
  };

  return (
    <div className="min-h-screen bg-[#07090e] text-slate-100 flex flex-col justify-between p-3.5 sm:p-5 font-sans selection:bg-indigo-500 relative">
      
      {!isConnected && (
        <div className="fixed top-0 left-0 right-0 bg-amber-500 text-slate-950 text-[11px] font-black py-1 px-4 text-center flex items-center justify-center space-x-2 z-50 shadow-md tracking-wide">
          <WifiOff className="w-3.5 h-3.5 animate-pulse" />
          <span>Reconnecting to Game Server... Your buzzer will re-sync automatically.</span>
        </div>
      )}

      {toastMessage && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 animate-bounce duration-300 w-[90%] max-w-sm">
          <div className="bg-slate-900/95 border border-indigo-500/80 text-indigo-100 px-4 py-2.5 rounded-2xl shadow-2xl flex items-center space-x-3 backdrop-blur-xl">
            <Info className="w-4 h-4 text-indigo-400 shrink-0" />
            <span className="text-xs font-semibold tracking-wide truncate">{toastMessage}</span>
          </div>
        </div>
      )}

      {kickedNotice && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 bg-rose-950/90 border border-rose-500 text-rose-200 px-5 py-3 rounded-2xl shadow-2xl flex items-center space-x-3 backdrop-blur-xl w-[90%] max-w-sm">
          <LogOut className="w-4 h-4 shrink-0 text-rose-400" />
          <span className="text-xs font-bold flex-1">{kickedNotice}</span>
          <button onClick={() => setKickedNotice('')} className="text-[10px] bg-rose-800 hover:bg-rose-700 px-2 py-1 rounded-lg text-white font-bold">Dismiss</button>
        </div>
      )}

      {confirmModal.open && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 max-w-xs w-full p-6 rounded-3xl space-y-4 shadow-2xl text-center">
            <div className="w-12 h-12 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-2xl flex items-center justify-center mx-auto">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <h3 className="text-base font-extrabold text-white">Confirm Removal</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              {confirmModal.type === 'PLAYER' 
                ? `Remove "${confirmModal.playerName}" from "${confirmModal.teamName}"?`
                : `Delete team "${confirmModal.teamName}"?`}
            </p>
            <div className="flex space-x-2 pt-2">
              <button onClick={() => setConfirmModal({ open: false, type: '', teamName: '', playerName: '' })} className="w-1/2 py-2.5 bg-slate-800 hover:bg-slate-700 font-bold text-xs rounded-xl border border-slate-700">Cancel</button>
              <button onClick={confirmAction} className="w-1/2 py-2.5 bg-rose-600 hover:bg-rose-500 font-bold text-xs rounded-xl text-white shadow-lg shadow-rose-600/30">Remove</button>
            </div>
          </div>
        </div>
      )}

      {membersModalTeam && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 max-w-xs w-full p-5 rounded-3xl space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-800 pb-2.5">
              <h3 className="text-xs font-black text-indigo-300 uppercase tracking-wider">Team: {membersModalTeam}</h3>
              <button onClick={() => setMembersModalTeam(null)} className="text-slate-400 hover:text-white text-xs font-bold px-2 py-0.5 bg-slate-800 rounded-lg">✕</button>
            </div>
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {(teams[membersModalTeam]?.members || []).length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-4">No members online.</p>
              ) : (
                teams[membersModalTeam]?.members?.map((m, idx) => (
                  <div key={idx} className="bg-slate-950/80 px-3.5 py-2 rounded-xl border border-slate-800/80 text-xs font-semibold text-slate-200 flex items-center justify-between">
                    <span>{getMemberName(m)}</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  </div>
                ))
              )}
            </div>
            <button onClick={() => setMembersModalTeam(null)} className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-xs font-bold rounded-xl border border-slate-700">Done</button>
          </div>
        </div>
      )}

      {/* HEADER */}
      <header className="flex justify-between items-center pb-3 border-b border-slate-800/60">
        <div className="flex items-center space-x-2 cursor-pointer" onClick={() => setScreen('LANDING')}>
          <div className="p-1.5 bg-gradient-to-tr from-indigo-600 to-indigo-500 rounded-xl shadow-md shadow-indigo-500/20">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div className="flex items-center space-x-1.5">
            <h1 className="font-black text-base tracking-wider">BUZZER<span className="text-indigo-400">PRO</span></h1>
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]' : 'bg-rose-500 animate-pulse'}`} />
          </div>
        </div>

        {role === 'ROOT_ADMIN' && (
          <div className="bg-rose-950/60 border border-rose-600/60 px-3 py-1 rounded-xl flex items-center space-x-1.5">
            <Shield className="w-3.5 h-3.5 text-rose-400" />
            <span className="text-[10px] font-black text-rose-300 uppercase">God Mode</span>
          </div>
        )}

        {roomCode && role !== 'ROOT_ADMIN' && (
          <div className="flex items-center space-x-2">
            <div className="bg-slate-900/90 border border-slate-800 px-3 py-1 rounded-xl text-right flex flex-col justify-center">
              <span className="text-[9px] font-mono text-slate-400 tracking-wider">ROOM <span className="text-indigo-400 font-black">{roomCode}</span></span>
              <span className="text-[11px] font-extrabold text-white truncate max-w-[110px]">{playerRef.current || enteredName || hostName}</span>
            </div>
            <button 
              onClick={handleLeaveRoom}
              className="p-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-xl transition-all"
              title="Leave Room"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </header>

      {/* SCREEN 1: LANDING */}
      {screen === 'LANDING' && (
        <div className="max-w-sm mx-auto my-auto w-full space-y-5 text-center">
          <div className="space-y-1">
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white">Trivia Arena</h2>
            <p className="text-xs text-slate-400 font-medium">Real-time low-latency multiplayer buzzer</p>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/80 p-5 rounded-3xl space-y-3.5 shadow-2xl backdrop-blur-md">
            <button onClick={() => setScreen('CREATE_FORM')} className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 font-extrabold rounded-2xl flex items-center justify-center space-x-2 shadow-lg shadow-indigo-600/25 text-xs tracking-wide uppercase transition-all">
              <Shield className="w-4 h-4" />
              <span>Create Room (Host)</span>
            </button>

            <div className="flex space-x-2 pt-1">
              <button onClick={() => setScreen('JOIN_HOST_FORM')} className="w-1/2 py-3 bg-indigo-950/40 hover:bg-indigo-900/60 border border-indigo-700/40 font-bold text-xs rounded-xl flex items-center justify-center space-x-1.5 text-indigo-300 transition-all">
                <Shield className="w-3.5 h-3.5 text-indigo-400" />
                <span>Join Host</span>
              </button>
              <button onClick={() => setScreen('JOIN_PARTICIPANT_FORM')} className="w-1/2 py-3 bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 font-bold text-xs rounded-xl flex items-center justify-center space-x-1.5 text-slate-200 transition-all">
                <Users className="w-3.5 h-3.5 text-emerald-400" />
                <span>Join Player</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE ROOM FORM */}
      {screen === 'CREATE_FORM' && (
        <div className="max-w-sm mx-auto my-auto w-full space-y-4 text-center">
          <div className="flex items-center justify-between px-1">
            <button onClick={() => setScreen('LANDING')} className="p-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-400 hover:text-white flex items-center space-x-1 text-xs font-bold">
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-300">Create New Room</h2>
            <div className="w-10"></div>
          </div>

          <form onSubmit={handleCreateRoomSubmit} className="bg-slate-900/60 border border-slate-800/80 p-5 rounded-3xl space-y-3.5 shadow-2xl text-left backdrop-blur-md">
            <div>
              <label className="text-[10px] font-extrabold uppercase text-slate-400 block mb-1 tracking-wider">Host Name</label>
              <input type="text" placeholder="Enter your name" value={hostName} onChange={(e) => setHostName(e.target.value)} className="w-full bg-slate-950/80 border border-slate-800 text-xs rounded-xl py-2.5 px-3.5 outline-none focus:border-indigo-500" required />
            </div>

            <div>
              <label className="text-[10px] font-extrabold uppercase text-slate-400 block mb-1 tracking-wider">Host Pass (4 Chars)</label>
              <div className="relative">
                <input type="password" maxLength={4} placeholder="4-digit pass" value={hostPassword} onChange={(e) => setHostPassword(e.target.value)} className="w-full bg-slate-950/80 border border-slate-800 text-xs rounded-xl py-2.5 px-3.5 outline-none focus:border-indigo-500 pr-9 tracking-widest font-mono" required />
                <Lock className="w-3.5 h-3.5 text-indigo-400 absolute right-3 top-3" />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-extrabold uppercase text-slate-400 block mb-1 tracking-wider">Player Pass (4 Chars)</label>
              <div className="relative">
                <input type="password" maxLength={4} placeholder="4-digit pass" value={participantPassword} onChange={(e) => setParticipantPassword(e.target.value)} className="w-full bg-slate-950/80 border border-slate-800 text-xs rounded-xl py-2.5 px-3.5 outline-none focus:border-indigo-500 pr-9 tracking-widest font-mono" required />
                <KeyRound className="w-3.5 h-3.5 text-emerald-400 absolute right-3 top-3" />
              </div>
            </div>

            <button type="submit" className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 font-extrabold rounded-xl flex items-center justify-center space-x-2 text-xs text-white shadow-lg shadow-indigo-600/30 transition-all mt-1">
              <Shield className="w-3.5 h-3.5" />
              <span>Initialize Arena</span>
            </button>
          </form>
        </div>
      )}

      {/* JOIN AS HOST FORM */}
      {screen === 'JOIN_HOST_FORM' && (
        <div className="max-w-sm mx-auto my-auto w-full space-y-4 text-center">
          <div className="flex items-center justify-between px-1">
            <button onClick={() => setScreen('LANDING')} className="p-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-400 hover:text-white flex items-center space-x-1 text-xs font-bold">
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-300">Join as Host</h2>
            <div className="w-10"></div>
          </div>

          <form onSubmit={handleJoinHostSubmit} className="bg-slate-900/60 border border-slate-800/80 p-5 rounded-3xl space-y-3.5 shadow-2xl text-left backdrop-blur-md">
            <div>
              <label className="text-[10px] font-extrabold uppercase text-slate-400 block mb-1 tracking-wider">Host Name</label>
              <input type="text" placeholder="Enter your name" value={enteredName} onChange={(e) => setEnteredName(e.target.value)} className="w-full bg-slate-950/80 border border-slate-800 text-xs rounded-xl py-2.5 px-3.5 outline-none focus:border-indigo-500" required />
            </div>

            <div>
              <label className="text-[10px] font-extrabold uppercase text-slate-400 block mb-1 tracking-wider">Room ID</label>
              <input type="text" placeholder="6-Digit Room Code" value={enteredRoomCode} onChange={(e) => setEnteredRoomCode(e.target.value)} className="w-full bg-slate-950/80 border border-slate-800 text-xs font-mono rounded-xl py-2.5 px-3.5 outline-none focus:border-indigo-500" required />
            </div>

            <div>
              <label className="text-[10px] font-extrabold uppercase text-slate-400 block mb-1 tracking-wider">Host Password</label>
              <input type="password" maxLength={4} placeholder="4-digit password" value={enteredPassword} onChange={(e) => setEnteredPassword(e.target.value)} className="w-full bg-slate-950/80 border border-slate-800 text-xs rounded-xl py-2.5 px-3.5 outline-none focus:border-indigo-500 tracking-widest font-mono" required />
            </div>

            <button type="submit" className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 font-extrabold rounded-xl flex items-center justify-center space-x-2 text-xs text-white shadow-lg shadow-indigo-600/30 transition-all mt-1">
              <Shield className="w-3.5 h-3.5" />
              <span>Enter Host Panel</span>
            </button>
          </form>
        </div>
      )}

      {/* JOIN AS PARTICIPANT FORM */}
      {screen === 'JOIN_PARTICIPANT_FORM' && (
        <div className="max-w-sm mx-auto my-auto w-full space-y-4 text-center">
          <div className="flex items-center justify-between px-1">
            <button onClick={() => setScreen('LANDING')} className="p-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-400 hover:text-white flex items-center space-x-1 text-xs font-bold">
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-300">Join as Player</h2>
            <div className="w-10"></div>
          </div>

          <form onSubmit={handleJoinParticipantSubmit} className="bg-slate-900/60 border border-slate-800/80 p-5 rounded-3xl space-y-3.5 shadow-2xl text-left backdrop-blur-md">
            <div>
              <label className="text-[10px] font-extrabold uppercase text-slate-400 block mb-1 tracking-wider">Your Name</label>
              <input type="text" placeholder="Enter your name" value={enteredName} onChange={(e) => setEnteredName(e.target.value)} className="w-full bg-slate-950/80 border border-slate-800 text-xs rounded-xl py-2.5 px-3.5 outline-none focus:border-indigo-500" required />
            </div>

            <div>
              <label className="text-[10px] font-extrabold uppercase text-slate-400 block mb-1 tracking-wider">Room ID</label>
              <input type="text" placeholder="6-Digit Room Code" value={enteredRoomCode} onChange={(e) => setEnteredRoomCode(e.target.value)} className="w-full bg-slate-950/80 border border-slate-800 text-xs font-mono rounded-xl py-2.5 px-3.5 outline-none focus:border-indigo-500" required />
            </div>

            <div>
              <label className="text-[10px] font-extrabold uppercase text-slate-400 block mb-1 tracking-wider">Player Pass (4 Chars)</label>
              <input type="password" maxLength={4} placeholder="4-digit password" value={enteredPassword} onChange={(e) => setEnteredPassword(e.target.value)} className="w-full bg-slate-950/80 border border-slate-800 text-xs rounded-xl py-2.5 px-3.5 outline-none focus:border-indigo-500 tracking-widest font-mono" required />
            </div>

            <button type="submit" className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 font-extrabold rounded-xl flex items-center justify-center space-x-2 text-xs text-white shadow-lg shadow-emerald-600/30 transition-all mt-1">
              <UserPlus className="w-3.5 h-3.5" />
              <span>Select Team</span>
            </button>
          </form>
        </div>
      )}

      {/* SCREEN 2: GAME ARENA */}
      {screen === 'GAME' && (
        <div className="max-w-5xl mx-auto my-auto w-full grid grid-cols-1 lg:grid-cols-3 gap-5 py-2">
          <div className="lg:col-span-2 space-y-4">

            {/* COUNTDOWN CLOCK BANNER & TIME UP DISPLAY */}
            {timerConfig.enabled && isTimerActive && timerLeft !== null && (
              <div className={`p-3.5 rounded-2xl border text-center transition-all duration-300 shadow-xl flex items-center justify-between px-6 ${
                timerLeft === 0
                  ? 'bg-rose-950 border-rose-500 animate-pulse text-rose-200'
                  : timerLeft <= 5 
                    ? 'bg-rose-950/90 border-rose-500/80 animate-pulse text-rose-300' 
                    : timerLeft <= 10 
                      ? 'bg-amber-950/80 border-amber-500/80 text-amber-300' 
                      : 'bg-indigo-950/80 border-indigo-500/80 text-indigo-200'
              }`}>
                <div className="flex items-center space-x-3">
                  <Timer className={`w-6 h-6 ${timerLeft <= 5 ? 'text-rose-400' : 'text-indigo-400'}`} />
                  <div className="text-left">
                    <p className="text-[9px] uppercase font-bold tracking-widest text-slate-400">Current Turn</p>
                    <p className="text-xs font-black text-white truncate max-w-[140px]">{timerActiveTeam || 'Active Team'}</p>
                  </div>
                </div>

                <div className="text-right">
                  {timerLeft === 0 ? (
                    <span className="font-mono text-xl sm:text-2xl font-black text-rose-400 tracking-wider">TIME UP!</span>
                  ) : (
                    <span className="font-mono text-3xl font-black">{timerLeft}s</span>
                  )}
                </div>
              </div>
            )}

            {/* HOST CONTROLS */}
            {role === 'HOST' && (
              <div className="space-y-4">
                <div className="bg-slate-900/60 border border-slate-800/80 p-5 rounded-3xl flex flex-col items-center space-y-3 backdrop-blur-md shadow-xl">
                  <div className="p-2.5 bg-white rounded-2xl shadow-md">
                    <QRCodeSVG value={getQrUrl()} size={110} />
                  </div>
                  <p className="text-[11px] text-slate-400 font-medium">Scan to join Room <span className="text-indigo-400 font-mono font-bold">{roomCode}</span></p>
                  <button onClick={() => socketRef.current && socketRef.current.emit('RESET_BUZZER', { roomCode })} className="w-full py-3 bg-slate-800 hover:bg-slate-700/80 border border-slate-700 rounded-xl font-bold flex items-center justify-center space-x-2 text-indigo-300 text-xs shadow-md transition-all">
                    <RotateCcw className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Reset All Buzzers (Next Question)</span>
                  </button>
                </div>

                {/* TIMER SETTINGS */}
                <div className="bg-slate-900/60 border border-slate-800/80 p-4 rounded-3xl space-y-3 backdrop-blur-md">
                  <div className="flex justify-between items-center border-b border-slate-800/80 pb-2.5">
                    <div className="flex items-center space-x-2">
                      <Clock className="w-4 h-4 text-indigo-400" />
                      <h3 className="text-xs font-black uppercase text-slate-300 tracking-wider">Answer Timer</h3>
                    </div>
                    
                    <button
                      onClick={handleToggleTimer}
                      className={`px-3 py-1 rounded-xl font-bold text-[11px] flex items-center space-x-1.5 transition-all ${
                        timerConfig.enabled 
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50' 
                          : 'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${timerConfig.enabled ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                      <span>{timerConfig.enabled ? 'Timer ON' : 'Timer OFF'}</span>
                    </button>
                  </div>

                  {timerConfig.enabled && (
                    <div className="space-y-2.5 pt-0.5">
                      <div className="flex flex-wrap gap-1.5 items-center">
                        {[10, 15, 30, 45, 60].map((dur) => (
                          <button
                            key={dur}
                            onClick={() => handleSetTimerDuration(dur)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all ${
                              timerConfig.duration === dur 
                                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30' 
                                : 'bg-slate-950/70 hover:bg-slate-800 text-slate-300 border border-slate-800'
                            }`}
                          >
                            {dur}s
                          </button>
                        ))}
                        
                        <div className="flex items-center space-x-1.5 ml-auto">
                          <span className="text-[10px] text-slate-500 font-mono">Custom:</span>
                          <input
                            type="number"
                            min="5"
                            max="300"
                            value={timerConfig.duration}
                            onChange={(e) => handleSetTimerDuration(e.target.value)}
                            className="w-14 bg-slate-950/80 border border-slate-800 rounded-lg px-2 py-1 text-xs font-mono text-center outline-none focus:border-indigo-500"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Team Creation */}
                <div className="bg-slate-900/60 border border-slate-800/80 p-4 rounded-3xl space-y-2.5 backdrop-blur-md">
                  <h3 className="text-[11px] font-black uppercase text-slate-400 tracking-wider flex items-center space-x-1.5">
                    <Users className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Create Team</span>
                  </h3>
                  <form onSubmit={handleCreateTeam} className="flex space-x-2">
                    <input type="text" placeholder="Enter new team name" value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} className="flex-1 bg-slate-950/80 border border-slate-800 text-xs rounded-xl py-2 px-3 outline-none focus:border-indigo-500" />
                    <button type="submit" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 font-extrabold rounded-xl text-xs flex items-center space-x-1 shadow-md">
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add</span>
                    </button>
                  </form>
                </div>

                {/* Speed Queue */}
                <div className="bg-slate-900/60 border border-slate-800/80 p-4 rounded-3xl space-y-2.5 backdrop-blur-md">
                  <h3 className="text-[11px] font-black uppercase text-slate-400 tracking-wider flex items-center space-x-1.5">
                    <Volume2 className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Live Speed Queue</span>
                  </h3>
                  {queue.length === 0 ? (
                    <p className="text-slate-500 text-xs py-5 text-center">Waiting for players to buzz...</p>
                  ) : (
                    queue.map((item, index) => (
                      <div key={index} className={`flex justify-between items-center p-3 rounded-xl border ${index === 0 ? 'bg-amber-500/10 border-amber-500/40 text-amber-300' : 'bg-slate-950/70 border-slate-800/80'}`}>
                        <div className="flex items-center space-x-2.5">
                          <span className="font-mono font-black text-xs">#{index + 1}</span>
                          <div>
                            <p className="font-bold text-xs">{item.teamName}</p>
                            <p className="text-[10px] text-slate-400">By: {item.playerName}</p>
                          </div>
                        </div>
                        
                        {index === 0 && (
                          <div className="flex items-center space-x-1.5">
                            <button 
                              onClick={() => {
                                playSound('CORRECT');
                                socketRef.current && socketRef.current.emit('UPDATE_SCORE_AND_NEXT_QUESTION', { roomCode, teamName: item.teamName, delta: 5 });
                              }}
                              className="px-2.5 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/40 rounded-lg flex items-center space-x-1 text-xs font-bold"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>+5</span>
                            </button>
                            <button 
                              onClick={() => {
                                socketRef.current && socketRef.current.emit('PASS_TO_NEXT', { roomCode });
                              }}
                              className="px-2.5 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/40 rounded-lg flex items-center space-x-1 text-xs font-bold"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              <span>Pass</span>
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* PARTICIPANT ARENA */}
            {role === 'PARTICIPANT' && (
              <div className="flex flex-col items-center justify-center space-y-5">
                {!teamRef.current ? (
                  <div className="w-full bg-slate-900/60 border border-slate-800/80 p-5 rounded-3xl space-y-3.5 backdrop-blur-md">
                    <h3 className="text-xs font-black text-indigo-300 uppercase tracking-wider text-center">Join Your Assigned Team</h3>
                    
                    <div className="space-y-2 pt-1">
                      {Object.keys(teams).length === 0 ? (
                        <p className="text-slate-500 text-xs text-center py-6">Waiting for the host to create teams...</p>
                      ) : (
                        Object.entries(teams).map(([tName, data]) => {
                          const memberCount = (data.members || []).length;
                          return (
                            <div key={tName} className="bg-slate-950/70 p-3.5 rounded-2xl border border-slate-800/80 flex items-center justify-between shadow-sm">
                              <div>
                                <p className="font-bold text-xs text-white">{tName}</p>
                                <p className="text-[10px] text-slate-400 font-mono">{memberCount} member{memberCount === 1 ? '' : 's'}</p>
                              </div>
                              <div className="flex items-center space-x-1.5">
                                <button onClick={() => setMembersModalTeam(tName)} className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700">
                                  <Users className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => handleJoinTeam(tName)} className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl shadow-md text-xs font-bold flex items-center space-x-1">
                                  <Plus className="w-3 h-3" />
                                  <span>Join</span>
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="w-full flex flex-col items-center space-y-4">
                    
                    {/* SUB-NAV STRIP */}
                    <div className="w-full bg-slate-900/60 border border-slate-800/80 px-4 py-2.5 rounded-2xl backdrop-blur-md flex items-center justify-between shadow-lg">
                      <div className="flex items-center space-x-2">
                        <div className="bg-indigo-500/10 border border-indigo-500/30 px-3 py-1 rounded-xl">
                          <span className="text-[9px] uppercase font-extrabold text-indigo-400 block tracking-wider leading-none">TEAM</span>
                          <span className="text-xs font-black text-white leading-tight">{teamRef.current}</span>
                        </div>

                        {timerConfig.enabled && (
                          <div className="bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 rounded-xl flex items-center space-x-1">
                            <Clock className="w-3 h-3 text-amber-400" />
                            <span className="text-[11px] font-mono font-bold text-amber-300">{timerConfig.duration}s</span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center space-x-1.5">
                        <button onClick={() => setMembersModalTeam(teamRef.current)} className="px-2.5 py-1.5 bg-slate-800/80 hover:bg-slate-700 border border-slate-700 rounded-xl text-[11px] font-semibold text-slate-200 flex items-center space-x-1 transition-all">
                          <Users className="w-3 h-3 text-indigo-400" />
                          <span>Roster ({(teams[teamRef.current]?.members || []).length})</span>
                        </button>
                        <button onClick={handleLeaveTeam} className="px-2.5 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-xl text-[11px] font-semibold flex items-center space-x-1 transition-all">
                          <LogOut className="w-3 h-3" />
                          <span>Exit</span>
                        </button>
                      </div>
                    </div>

                    {/* TOUCH BUZZER (GREEN WHEN LOCKED, TURNS RED ON TIME UP) */}
                    <div className="py-2 flex flex-col items-center justify-center">
                      <button
                        onPointerDown={handleBuzz}
                        disabled={isBuzzedConfirmed}
                        className={`w-56 h-56 sm:w-60 sm:h-60 rounded-full select-none transition-transform duration-75 active:scale-95 flex items-center justify-center relative ${
                          isBuzzedConfirmed 
                            ? 'bg-slate-900 border-4 border-emerald-500/80 shadow-[0_0_40px_rgba(16,185,129,0.25)] cursor-not-allowed pointer-events-none' 
                            : 'bg-gradient-to-b from-rose-500 via-red-600 to-rose-800 border-4 border-red-400/80 shadow-[0_15px_35px_rgba(225,29,72,0.45)] active:translate-y-1 cursor-pointer'
                        }`}
                        style={{ touchAction: 'manipulation' }}
                      >
                        <div className={`absolute inset-2 rounded-full border border-white/20 pointer-events-none ${isBuzzedConfirmed ? 'hidden' : 'block'}`} />
                        
                        <div className="flex flex-col items-center space-y-0.5 select-none pointer-events-none">
                          {isBuzzedConfirmed ? (
                            <>
                              <Check className="w-8 h-8 text-emerald-400" />
                              <span className="text-3xl font-black text-emerald-400 font-mono tracking-tighter">#{myRank}</span>
                              <span className="text-[10px] font-extrabold tracking-widest text-emerald-300 uppercase">LOCKED IN</span>
                            </>
                          ) : (
                            <>
                              <span className="text-3xl font-black tracking-widest text-white drop-shadow-md">BUZZ</span>
                              <span className="text-[9px] font-extrabold tracking-wider text-rose-200/80 uppercase">TOUCH TO HIT</span>
                            </>
                          )}
                        </div>
                      </button>
                    </div>

                    <p className="text-[11px] font-medium text-slate-500 text-center">
                      {isBuzzedConfirmed ? `Buzzed at Position #${myRank}! Waiting for host verdict...` : 'Tap buzzer to lock in the turn for your team'}
                    </p>

                    {/* LIVE SPEED QUEUE */}
                    <div className="w-full bg-slate-900/60 border border-slate-800/80 p-4 rounded-3xl space-y-2.5 backdrop-blur-md">
                      <h3 className="text-[11px] font-black uppercase text-slate-400 tracking-wider flex items-center space-x-1.5">
                        <Volume2 className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Speed Queue</span>
                      </h3>
                      {queue.length === 0 ? (
                        <p className="text-slate-500 text-xs py-3 text-center">Ready for next question...</p>
                      ) : (
                        queue.map((item, index) => {
                          const isMyTeam = (item.teamName || '').trim().toLowerCase() === (teamRef.current || '').trim().toLowerCase();
                          return (
                            <div key={index} className={`flex justify-between items-center p-2.5 rounded-xl border ${isMyTeam ? 'bg-indigo-950/60 border-indigo-500/60 text-indigo-200' : index === 0 ? 'bg-amber-500/10 border-amber-500/40 text-amber-300' : 'bg-slate-950/70 border-slate-800/80'}`}>
                              <div className="flex items-center space-x-2.5">
                                <span className="font-mono font-black text-xs">#{index + 1}</span>
                                <div>
                                  <p className="font-bold text-xs flex items-center space-x-1.5">
                                    <span>{item.teamName}</span>
                                    {isMyTeam && (
                                      <span className="text-[9px] bg-indigo-500/30 text-indigo-300 px-1 py-0.2 rounded font-mono">YOU</span>
                                    )}
                                  </p>
                                  <p className="text-[10px] text-slate-400">By: {item.playerName}</p>
                                </div>
                              </div>
                              {index === 0 && (
                                <span className="text-[9px] font-black bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-md uppercase tracking-wider">Turn</span>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* SCOREBOARD */}
            <div className="bg-slate-900/60 border border-slate-800/80 p-4 rounded-3xl space-y-2.5 backdrop-blur-md">
              <h3 className="text-[11px] font-black uppercase text-slate-400 tracking-wider flex items-center space-x-1.5">
                <Trophy className="w-3.5 h-3.5 text-amber-400" />
                <span>Scoreboard</span>
              </h3>
              <div className="grid grid-cols-1 gap-2">
                {Object.keys(teams).length === 0 ? (
                  <p className="text-slate-500 text-xs text-center py-2">No teams registered yet.</p>
                ) : (
                  Object.entries(teams).map(([name, data]) => {
                    const memberCount = (data.members || []).length;
                    return (
                      <div key={name} className={`bg-slate-950/70 p-3 rounded-xl border ${name === teamRef.current ? 'border-indigo-500/50' : 'border-slate-800/80'}`}>
                        <div className="flex justify-between items-center cursor-pointer" onClick={() => toggleTeamExpand(name)}>
                          <div>
                            <p className="font-bold text-xs flex items-center space-x-1.5">
                              <span>{name}</span>
                              <span className="text-[10px] text-slate-500 font-normal">({memberCount})</span>
                            </p>
                            <p className="text-[11px] text-indigo-400 font-mono font-black">{data.score} pts</p>
                          </div>
                          
                          <div className="flex items-center space-x-1.5">
                            {role === 'HOST' && (
                              <div className="flex items-center space-x-1 mr-1" onClick={(e) => e.stopPropagation()}>
                                <button onClick={() => handleScoreChange(name, -5)} className="p-1 text-slate-400 hover:text-rose-400 bg-slate-900 rounded border border-slate-800">
                                  <MinusCircle className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => handleScoreChange(name, 5)} className="p-1 text-slate-400 hover:text-emerald-400 bg-slate-900 rounded border border-slate-800">
                                  <PlusCircle className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                            {role === 'HOST' && (
                              <button onClick={(e) => { e.stopPropagation(); setConfirmModal({ open: true, type: 'TEAM', teamName: name, playerName: '' }); }} className="p-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg border border-rose-500/20">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button className="text-slate-400 hover:text-white">
                              {expandedTeams[name] ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </div>

                        {expandedTeams[name] && (
                          <div className="pt-2 border-t border-slate-800/60 mt-2 space-y-1.5">
                            <div className="flex flex-wrap gap-1.5">
                              {(data.members || []).map((m, i) => {
                                const mName = getMemberName(m);
                                return (
                                  <span key={i} className="px-2.5 py-0.5 bg-slate-900 border border-slate-800 rounded-lg text-[10px] font-semibold text-slate-300 flex items-center space-x-1.5">
                                   <span>{mName}</span>
                                   {role === 'HOST' && (
                                     <button onClick={() => setConfirmModal({ open: true, type: 'PLAYER', teamName: name, playerName: mName })} className="text-slate-500 hover:text-rose-400">
                                       <UserMinus className="w-2.5 h-2.5" />
                                     </button>
                                   )}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* ACTIVITY FEED */}
          <div className="space-y-4">
            <div className="bg-slate-900/60 border border-slate-800/80 p-4 rounded-3xl space-y-3 backdrop-blur-md">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <h3 className="text-[11px] font-black uppercase text-slate-400 tracking-wider flex items-center space-x-1.5">
                  <Activity className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Activity</span>
                </h3>
                <span className="text-[9px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full font-mono font-bold">LIVE</span>
              </div>

              <div className="space-y-1.5 overflow-y-auto max-h-56 pr-0.5">
                {activityLogs.length === 0 ? (
                  <p className="text-slate-500 text-xs text-center py-4">No activity recorded.</p>
                ) : (
                  activityLogs.map((log, index) => (
                    <div key={index} className="bg-slate-950/70 border border-slate-800/60 p-2.5 rounded-xl text-xs space-y-0.5">
                      <div className="flex justify-between items-center text-[9px] text-slate-500 font-mono">
                        <span className="text-indigo-400 font-bold">{log.type}</span>
                        <span>{log.time}</span>
                      </div>
                      <p className="text-slate-300 font-medium text-[11px]">{log.message}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ROOT ADMIN DASHBOARD */}
      {screen === 'ADMIN_DASHBOARD' && (
        <div className="max-w-5xl mx-auto my-auto w-full space-y-4 py-2">
          <div className="flex justify-between items-center bg-slate-900/60 border border-slate-800/80 p-4 rounded-3xl shadow-xl backdrop-blur-md">
            <div>
              <h2 className="text-base font-black text-white flex items-center space-x-2">
                <Server className="w-4 h-4 text-indigo-400" />
                <span>Room Control Center</span>
              </h2>
              <p className="text-[10px] text-slate-400">System telemetry across memory sessions.</p>
            </div>
            <div className="flex items-center space-x-2">
              <button onClick={handleRefreshAdminRooms} className="px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 text-xs font-bold rounded-xl border border-indigo-500/40 flex items-center space-x-1 transition-all">
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Refresh</span>
              </button>
              <button onClick={() => { setScreen('LANDING'); setRole(null); }} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-bold rounded-xl border border-slate-700">
                Exit
              </button>
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/80 rounded-3xl overflow-hidden shadow-2xl backdrop-blur-md">
            <div className="p-3 border-b border-slate-800 flex justify-between items-center bg-slate-950/40">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Total Rooms: {adminRoomsList.length}</span>
              <span className="text-[10px] text-emerald-400 font-mono font-bold">● LIVE PIPELINE</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-[10px] uppercase text-slate-400 font-black bg-slate-950/60">
                    <th className="p-3">Room</th>
                    <th className="p-3">Host</th>
                    <th className="p-3">Host Pass</th>
                    <th className="p-3">Player Pass</th>
                    <th className="p-3">Teams / Members</th>
                    <th className="p-3">Timer</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-xs font-medium">
                  {adminRoomsList.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-8 text-slate-500">No rooms tracked in memory.</td>
                    </tr>
                  ) : (
                    adminRoomsList.map((r) => (
                      <tr key={r.roomCode} className="hover:bg-slate-800/40 transition-colors">
                        <td className="p-3 font-mono font-bold text-indigo-400">{r.roomCode}</td>
                        <td className="p-3 font-bold text-white">{r.hostName}</td>
                        <td className="p-3 font-mono text-amber-300">{r.hostPassword}</td>
                        <td className="p-3 font-mono text-emerald-300">{r.participantPassword}</td>
                        <td className="p-3 font-mono text-slate-300">{r.teamsCount} teams ({r.totalMembers} p)</td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded-md text-[9px] font-mono font-bold ${r.timerConfig?.enabled ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'}`}>
                            {r.timerConfig?.enabled ? `${r.timerConfig.duration}s` : 'OFF'}
                          </span>
                        </td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${r.status === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'}`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          {r.status === 'ACTIVE' && (
                            <button onClick={() => handleTerminateRoom(r.roomCode)} className="px-2.5 py-1 bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 border border-rose-500/40 rounded-lg text-xs font-bold">
                              Kill
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* FOOTER */}
      <footer className="text-center py-3 border-t border-slate-900/60 mt-4 space-y-0.5">
        <p className="text-xs text-slate-500 font-semibold tracking-wide">Developed by Tabres</p>
        <p className="text-[10px] font-mono font-bold tracking-widest text-indigo-400/90 uppercase">
          Version {APP_VERSION}
        </p>
      </footer>
    </div>
  );
}
