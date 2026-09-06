'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';
import { 
  Shield, Users, RotateCcw, CheckCircle2, XCircle, Sparkles, Volume2, Trophy, 
  Lock, Check, UserMinus, Trash2, ChevronDown, ChevronUp, AlertTriangle, 
  LogOut, Info, KeyRound, Plus, UserPlus, Activity, ArrowLeft, Server, 
  PlusCircle, MinusCircle, Wifi, WifiOff
} from 'lucide-react';

const SOCKET_URL = "https://buzzer-n9va.onrender.com";

const playSound = (type) => {
  if (typeof window === 'undefined') return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'BUZZ') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } else if (type === 'CORRECT') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } else if (type === 'WRONG') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(200, ctx.currentTime);
      osc.frequency.setValueAtTime(130, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    }
  } catch (e) {
    console.error("Audio synth error:", e);
  }
};

export default function App() {
  const [screen, setScreen] = useState('LANDING'); // LANDING, CREATE_FORM, JOIN_HOST_FORM, JOIN_PARTICIPANT_FORM, GAME, ADMIN_DASHBOARD
  const [role, setRole] = useState(null); // HOST, PARTICIPANT, ROOT_ADMIN
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
  
  // Modals & Banners
  const [confirmModal, setConfirmModal] = useState({ open: false, type: '', teamName: '', playerName: '' });
  const [kickedNotice, setKickedNotice] = useState('');
  const [toastMessage, setToastMessage] = useState('');

  const socketRef = useRef(null);
  const teamRef = useRef('');
  const playerRef = useRef('');
  const roleRef = useRef(role);
  const roomCodeRef = useRef(roomCode);
  const roundIdRef = useRef(1);
  const buzzedLockRef = useRef(false); // Synchronous 0ms touch lock

  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  useEffect(() => {
    roomCodeRef.current = roomCode;
  }, [roomCode]);

  useEffect(() => {
    roundIdRef.current = roundId;
  }, [roundId]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const qRoom = params.get('room');
      if (qRoom) setEnteredRoomCode(qRoom);
    }
  }, []);

  useEffect(() => {
    socketRef.current = io(SOCKET_URL, { 
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 2000,
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

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    socket.on('ROOM_SYNCED', ({ roomCode: syncedRoom, teams: syncedTeams, queue: syncedQueue, logs: syncedLogs, roundId: rId }) => {
      setRoomCode(syncedRoom);
      setTeams(syncedTeams || {});
      setQueue(syncedQueue || []);
      if (syncedLogs) setActivityLogs(syncedLogs);
      if (rId) {
        setRoundId(rId);
        roundIdRef.current = rId;
      }
      const isBuzzed = (syncedQueue || []).some(item => item.teamName === teamRef.current);
      buzzedLockRef.current = isBuzzed;
      setHasBuzzedState(isBuzzed);
    });

    socket.on('ROOM_CREATED', ({ roomCode: rCode, logs, roundId: rId }) => {
      setRoomCode(rCode);
      setEnteredName(hostName);
      setRole('HOST');
      setScreen('GAME');
      if (logs) setActivityLogs(logs);
      if (rId) {
        setRoundId(rId);
        roundIdRef.current = rId;
      }
    });

    socket.on('HOST_JOIN_SUCCESS', ({ roomCode: rCode, teams: t, queue: q, logs, roundId: rId }) => {
      setRoomCode(rCode);
      setTeams(t || {});
      setQueue(q || []);
      setRole('HOST');
      setScreen('GAME');
      if (logs) setActivityLogs(logs);
      if (rId) {
        setRoundId(rId);
        roundIdRef.current = rId;
      }
    });

    socket.on('JOIN_SUCCESS', ({ roomCode: joinedRoom, teamName: joinedTeam, teams: t, logs, roundId: rId }) => {
      setRoomCode(joinedRoom);
      teamRef.current = joinedTeam || '';
      setTeams(t || {});
      setRole('PARTICIPANT');
      setScreen('GAME');
      if (logs) setActivityLogs(logs);
      if (rId) {
        setRoundId(rId);
        roundIdRef.current = rId;
      }
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
    socket.on('TEAMS_UPDATED', (updatedTeams) => setTeams(updatedTeams));

    // High-performance lean queue event
    socket.on('BUZZER_QUEUE_UPDATED', ({ queue: updatedQueue, roundId: currentRId }) => {
      setQueue(updatedQueue);
      if (currentRId) {
        setRoundId(currentRId);
        roundIdRef.current = currentRId;
      }

      const isMyTeamInQueue = updatedQueue.some(item => item.teamName === teamRef.current);
      if (isMyTeamInQueue) {
        buzzedLockRef.current = true;
        setHasBuzzedState(true);
      }

      if (updatedQueue.length > 0) playSound('BUZZ');
    });

    socket.on('BUZZER_RESET', ({ roundId: nextRoundId }) => {
      setQueue([]);
      buzzedLockRef.current = false;
      setHasBuzzedState(false);
      if (nextRoundId) {
        setRoundId(nextRoundId);
        roundIdRef.current = nextRoundId;
      }
    });

    // Append single lightweight log instead of rerendering entire history
    socket.on('NEW_ACTIVITY_LOG', (logItem) => {
      setActivityLogs((prev) => [logItem, ...prev.slice(0, 29)]);
    });

    socket.on('HOST_ACTION_NOTICE', ({ message }) => {
      setToastMessage(message);
      setTimeout(() => setToastMessage(''), 4000);
    });

    socket.on('TEAM_REMOVED', ({ teamName: removedTeam }) => {
      if (roleRef.current === 'PARTICIPANT' && teamRef.current === removedTeam) {
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
        setKickedNotice('Host removed you from the team.');
        setScreen('LANDING');
        setRole(null);
        teamRef.current = '';
        buzzedLockRef.current = false;
        setHasBuzzedState(false);
      }
    });

    socket.on('KICKED_OUT', ({ message }) => {
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
    if (!hostName || !hostPassword || !participantPassword) return alert('Please fill in all fields!');
    if (hostPassword.length !== 4 || participantPassword.length !== 4) {
      return alert('Both passwords must be 4 characters!');
    }
    if (hostPassword === participantPassword) {
      return alert('Host Password and Participant Password CANNOT be the same!');
    }
    playerRef.current = hostName;
    socketRef.current.emit('CREATE_ROOM', { hostName, hostPassword, participantPassword, joinMethod: 'Manual ID' });
  };

  const handleJoinHostSubmit = (e) => {
    e.preventDefault();
    const targetRoom = enteredRoomCode.trim();
    if (!targetRoom || !enteredPassword) return alert('Please enter room code and password!');
    
    playerRef.current = enteredName || 'Host';
    socketRef.current.emit('JOIN_AS_HOST', { 
      roomCode: targetRoom, 
      hostName: enteredName || 'Host', 
      hostPassword: enteredPassword, 
      joinMethod: 'Manual ID' 
    });
  };

  const handleJoinParticipantSubmit = (e) => {
    e.preventDefault();
    const targetRoom = enteredRoomCode.trim();
    if (!targetRoom || !enteredName || !enteredPassword) return alert('Please fill in all fields!');
    
    playerRef.current = enteredName;
    socketRef.current.emit('JOIN_ROOM_INITIAL', { 
      roomCode: targetRoom, 
      playerName: enteredName, 
      participantPassword: enteredPassword, 
      joinMethod: 'Manual ID' 
    });
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
    socketRef.current.emit('JOIN_TEAM_SPECIFIC', { roomCode, teamName: targetTeamName, playerName: enteredName });
  };

  const handleLeaveTeam = () => {
    if (socketRef.current && teamRef.current) {
      socketRef.current.emit('LEAVE_TEAM', { roomCode, teamName: teamRef.current, playerName: enteredName });
      teamRef.current = '';
      buzzedLockRef.current = false;
      setHasBuzzedState(false);
      setTeams((prev) => ({ ...prev }));
    }
  };

  const handleLeaveRoom = () => {
    if (window.confirm("Are you sure you want to exit this room?")) {
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

  const fillMasterAdmin = () => {
    setEnteredName('admin');
    setEnteredRoomCode('0000');
    setEnteredPassword('9676');
  };

  const myTeamQueueIndex = queue.findIndex((item) => item.teamName === teamRef.current);
  const isBuzzedConfirmed = myTeamQueueIndex !== -1 || hasBuzzedState;
  const myRank = myTeamQueueIndex !== -1 ? myTeamQueueIndex + 1 : (hasBuzzedState ? '...' : null);

  // 0ms SYNCHRONOUS MEMORY LOCK: Prevents multiple taps from queuing up
  const handleBuzz = useCallback((e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (buzzedLockRef.current || isBuzzedConfirmed || !socketRef.current || !teamRef.current) {
      return;
    }

    // Instant lock
    buzzedLockRef.current = true;
    setHasBuzzedState(true);

    if (navigator.vibrate) navigator.vibrate(100);
    playSound('BUZZ');

    socketRef.current.emit('PRESS_BUZZER', { 
      roomCode, 
      teamName: teamRef.current, 
      playerName: enteredName,
      roundId: roundIdRef.current
    }, (ack) => {
      if (!ack || !ack.success) {
        if (ack && ack.reason === 'Stale round') {
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
    if (confirm(`Terminate Room #${targetCode} permanently?`)) {
      socketRef.current.emit('CLOSE_ROOM', { roomCode: targetCode });
    }
  };

  const getQrUrl = () => {
    if (typeof window !== 'undefined') {
      return `${window.location.origin}?room=${roomCode}`;
    }
    return roomCode;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 font-sans selection:bg-indigo-500 relative">
      
      {/* Real-time Connection Watcher */}
      {!isConnected && (
        <div className="fixed top-0 left-0 right-0 bg-amber-600 text-slate-950 text-xs font-black py-1.5 px-4 text-center flex items-center justify-center space-x-2 z-50 shadow-md">
          <WifiOff className="w-3.5 h-3.5 animate-pulse" />
          <span>Reconnecting to Game Server... Your buzzer will re-sync automatically.</span>
        </div>
      )}

      {toastMessage && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 animate-bounce duration-300">
          <div className="bg-slate-900 border border-indigo-500/80 text-indigo-200 px-5 py-2.5 rounded-xl shadow-2xl flex items-center space-x-3 backdrop-blur-md">
            <Info className="w-4 h-4 text-indigo-400 shrink-0" />
            <span className="text-xs font-semibold tracking-wide">{toastMessage}</span>
          </div>
        </div>
      )}

      {kickedNotice && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-rose-600/90 border border-rose-500 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center space-x-3 backdrop-blur-md">
          <LogOut className="w-5 h-5" />
          <span className="text-sm font-bold">{kickedNotice}</span>
          <button onClick={() => setKickedNotice('')} className="ml-4 text-xs bg-rose-800 hover:bg-rose-700 px-2 py-1 rounded-lg">Dismiss</button>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmModal.open && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 max-w-sm w-full p-6 rounded-3xl space-y-4 shadow-2xl text-center">
            <div className="w-12 h-12 bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-2xl flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-extrabold text-white">Are you sure?</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              {confirmModal.type === 'PLAYER' 
                ? `Remove player "${confirmModal.playerName}" from team "${confirmModal.teamName}"?`
                : `Remove team "${confirmModal.teamName}" and all its members?`}
            </p>
            <div className="flex space-x-3 pt-2">
              <button onClick={() => setConfirmModal({ open: false, type: '', teamName: '', playerName: '' })} className="w-1/2 py-3 bg-slate-800 hover:bg-slate-700 font-bold text-xs rounded-xl border border-slate-700">Cancel</button>
              <button onClick={confirmAction} className="w-1/2 py-3 bg-rose-600 hover:bg-rose-500 font-bold text-xs rounded-xl shadow-lg shadow-rose-600/30 text-white">Yes, Remove</button>
            </div>
          </div>
        </div>
      )}

      {/* Members Modal */}
      {membersModalTeam && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 max-w-sm w-full p-6 rounded-3xl space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-sm font-extrabold text-indigo-300 uppercase tracking-wider">Team: {membersModalTeam}</h3>
              <button onClick={() => setMembersModalTeam(null)} className="text-slate-400 hover:text-white text-sm font-bold px-2 py-1 bg-slate-800 rounded-lg">✕</button>
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {teams[membersModalTeam]?.members?.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-4">No members in this team yet.</p>
              ) : (
                teams[membersModalTeam]?.members?.map((m, idx) => (
                  <div key={idx} className="bg-slate-950 px-4 py-2.5 rounded-xl border border-slate-800 text-xs font-semibold text-slate-200 flex items-center justify-between">
                    <span>{m}</span>
                    <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md">Online</span>
                  </div>
                ))
              )}
            </div>
            <button onClick={() => setMembersModalTeam(null)} className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-xs font-bold rounded-xl border border-slate-700">Close</button>
          </div>
        </div>
      )}

      {/* HEADER */}
      <header className="flex justify-between items-center pb-4 border-b border-slate-800">
        <div className="flex items-center space-x-2 cursor-pointer" onClick={() => setScreen('LANDING')}>
          <div className="p-2 bg-indigo-600 rounded-xl">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div className="flex items-center space-x-2">
            <h1 className="font-extrabold text-lg tracking-wider">BUZZER<span className="text-indigo-400">PRO</span></h1>
            <span className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-emerald-500 ring-4 ring-emerald-500/20' : 'bg-rose-500 ring-4 ring-rose-500/20'}`} title={isConnected ? 'Connected' : 'Disconnected'} />
          </div>
        </div>

        {role === 'ROOT_ADMIN' && (
          <div className="bg-rose-950 border border-rose-600 px-4 py-1.5 rounded-2xl flex items-center space-x-2">
            <Shield className="w-4 h-4 text-rose-400" />
            <span className="text-xs font-black text-rose-200">ROOT ADMIN ACCESS</span>
          </div>
        )}

        {roomCode && role !== 'ROOT_ADMIN' && (
          <div className="flex items-center space-x-3">
            <div className="bg-slate-900 border border-slate-700 px-4 py-1.5 rounded-2xl text-right">
              <div className="text-xs font-mono text-slate-400">ROOM: <span className="text-indigo-400 font-bold">{roomCode}</span></div>
              <div className="text-xs font-bold text-white">{enteredName || hostName} ({role})</div>
              <div className="text-[10px] font-extrabold tracking-wider text-amber-400 uppercase">
                {role === 'HOST' ? 'HOST' : teamRef.current || 'NO TEAM'}
              </div>
            </div>
            <button 
              onClick={handleLeaveRoom}
              className="p-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-xl transition-all"
              title="Leave Room"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </header>

      {/* SCREEN 1: LANDING */}
      {screen === 'LANDING' && (
        <div className="max-w-md mx-auto my-auto w-full space-y-6 text-center">
          <h2 className="text-3xl font-extrabold">Trivia Arena</h2>
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-4 shadow-2xl">
            <p className="text-xs text-slate-400 uppercase font-bold tracking-wider mb-2">Select Your Option</p>
            <button onClick={() => setScreen('CREATE_FORM')} className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 font-bold rounded-2xl flex items-center justify-center space-x-2 shadow-lg shadow-indigo-500/20 text-sm transition-all">
              <Shield className="w-5 h-5" />
              <span>Create Room (Host)</span>
            </button>

            <div className="flex space-x-3 pt-2">
              <button onClick={() => setScreen('JOIN_HOST_FORM')} className="w-1/2 py-3.5 bg-indigo-950 hover:bg-indigo-900 border border-indigo-700/60 font-bold text-xs rounded-xl flex items-center justify-center space-x-1.5 text-indigo-300 shadow-md transition-all">
                <Shield className="w-4 h-4 text-indigo-400" />
                <span>Join as Host</span>
              </button>
              <button onClick={() => setScreen('JOIN_PARTICIPANT_FORM')} className="w-1/2 py-3.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 font-bold text-xs rounded-xl flex items-center justify-center space-x-1.5 text-slate-200 shadow-md transition-all">
                <Users className="w-4 h-4 text-emerald-400" />
                <span>Join as Participant</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE ROOM FORM */}
      {screen === 'CREATE_FORM' && (
        <div className="max-w-md mx-auto my-auto w-full space-y-6 text-center">
          <div className="flex items-center justify-between">
            <button onClick={() => setScreen('LANDING')} className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-slate-400 hover:text-white flex items-center space-x-1 text-xs font-bold">
              <ArrowLeft className="w-4 h-4" />
              <span>Back</span>
            </button>
            <h2 className="text-xl font-extrabold">Create New Room</h2>
            <div className="w-12"></div>
          </div>

          <form onSubmit={handleCreateRoomSubmit} className="bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-4 shadow-2xl text-left">
            <div>
              <label className="text-xs font-bold uppercase text-slate-400 block mb-1">Host Name</label>
              <input type="text" placeholder="Enter your name" value={hostName} onChange={(e) => setHostName(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-sm rounded-xl py-3 px-4 outline-none focus:border-indigo-500" required />
            </div>

            <div>
              <label className="text-xs font-bold uppercase text-slate-400 block mb-1">Host Password (4 Chars)</label>
              <div className="relative">
                <input type="password" maxLength={4} placeholder="4-digit password" value={hostPassword} onChange={(e) => setHostPassword(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-sm rounded-xl py-3 px-4 outline-none focus:border-indigo-500 pr-10 tracking-widest font-mono" required />
                <Lock className="w-4 h-4 text-indigo-400 absolute right-3 top-3.5" />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold uppercase text-slate-400 block mb-1">Participant Password (4 Chars)</label>
              <div className="relative">
                <input type="password" maxLength={4} placeholder="4-digit password" value={participantPassword} onChange={(e) => setParticipantPassword(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-sm rounded-xl py-3 px-4 outline-none focus:border-indigo-500 pr-10 tracking-widest font-mono" required />
                <KeyRound className="w-4 h-4 text-emerald-400 absolute right-3 top-3.5" />
              </div>
            </div>

            <button type="submit" className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 font-bold rounded-2xl flex items-center justify-center space-x-2 shadow-lg shadow-indigo-500/20 text-sm mt-2">
              <Shield className="w-4 h-4" />
              <span>Initialize Room</span>
            </button>
          </form>
        </div>
      )}

      {/* JOIN AS HOST FORM */}
      {screen === 'JOIN_HOST_FORM' && (
        <div className="max-w-md mx-auto my-auto w-full space-y-6 text-center">
          <div className="flex items-center justify-between">
            <button onClick={() => setScreen('LANDING')} className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-slate-400 hover:text-white flex items-center space-x-1 text-xs font-bold">
              <ArrowLeft className="w-4 h-4" />
              <span>Back</span>
            </button>
            <h2 className="text-xl font-extrabold">Join as Host</h2>
            <div className="w-12"></div>
          </div>

          <form onSubmit={handleJoinHostSubmit} className="bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-4 shadow-2xl text-left">
            <button
              type="button"
              onClick={fillMasterAdmin}
              className="w-full py-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/40 text-amber-300 font-mono text-xs rounded-xl flex items-center justify-center space-x-2 transition-all"
            >
              <KeyRound className="w-3.5 h-3.5 text-amber-400" />
              <span>Quick Fill Master Admin (admin / 0000 / 9676)</span>
            </button>

            <div>
              <label className="text-xs font-bold uppercase text-slate-400 block mb-1">Host Name</label>
              <input type="text" placeholder="Enter name or admin" value={enteredName} onChange={(e) => setEnteredName(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-sm rounded-xl py-3 px-4 outline-none focus:border-indigo-500" required />
            </div>

            <div>
              <label className="text-xs font-bold uppercase text-slate-400 block mb-1">Room ID</label>
              <input type="text" placeholder="6-Digit Code (or 0000 for Admin)" value={enteredRoomCode} onChange={(e) => setEnteredRoomCode(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-base font-mono rounded-xl py-3 px-4 outline-none focus:border-indigo-500" required />
            </div>

            <div>
              <label className="text-xs font-bold uppercase text-slate-400 block mb-1">Host Password</label>
              <input type="password" maxLength={4} placeholder="4-digit password (e.g. 9676)" value={enteredPassword} onChange={(e) => setEnteredPassword(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-sm rounded-xl py-3 px-4 outline-none focus:border-indigo-500 tracking-widest font-mono" required />
            </div>

            <button type="submit" className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 font-bold rounded-2xl flex items-center justify-center space-x-2 shadow-lg shadow-indigo-500/20 text-sm mt-2">
              <Shield className="w-4 h-4" />
              <span>Enter as Co-Host</span>
            </button>
          </form>
        </div>
      )}

      {/* JOIN AS PARTICIPANT FORM */}
      {screen === 'JOIN_PARTICIPANT_FORM' && (
        <div className="max-w-md mx-auto my-auto w-full space-y-6 text-center">
          <div className="flex items-center justify-between">
            <button onClick={() => setScreen('LANDING')} className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-slate-400 hover:text-white flex items-center space-x-1 text-xs font-bold">
              <ArrowLeft className="w-4 h-4" />
              <span>Back</span>
            </button>
            <h2 className="text-xl font-extrabold">Join as Participant</h2>
            <div className="w-12"></div>
          </div>

          <form onSubmit={handleJoinParticipantSubmit} className="bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-4 shadow-2xl text-left">
            <div>
              <label className="text-xs font-bold uppercase text-slate-400 block mb-1">Your Name</label>
              <input type="text" placeholder="Enter your name" value={enteredName} onChange={(e) => setEnteredName(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-sm rounded-xl py-3 px-4 outline-none focus:border-indigo-500" required />
            </div>

            <div>
              <label className="text-xs font-bold uppercase text-slate-400 block mb-1">Room ID</label>
              <input type="text" placeholder="6-Digit Room Code" value={enteredRoomCode} onChange={(e) => setEnteredRoomCode(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-base font-mono rounded-xl py-3 px-4 outline-none focus:border-indigo-500" required />
            </div>

            <div>
              <label className="text-xs font-bold uppercase text-slate-400 block mb-1">Participant Password (4 Chars)</label>
              <input type="password" maxLength={4} placeholder="4-digit participant password" value={enteredPassword} onChange={(e) => setEnteredPassword(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-sm rounded-xl py-3 px-4 outline-none focus:border-indigo-500 tracking-widest font-mono" required />
            </div>

            <button type="submit" className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 font-bold rounded-2xl flex items-center justify-center space-x-2 shadow-lg shadow-emerald-500/20 text-sm mt-2 text-white">
              <UserPlus className="w-4 h-4" />
              <span>Continue to Team Selection</span>
            </button>
          </form>
        </div>
      )}

      {/* SCREEN 2: GAME DASHBOARD */}
      {screen === 'GAME' && (
        <div className="max-w-6xl mx-auto my-auto w-full grid grid-cols-1 lg:grid-cols-3 gap-6 py-4">
          <div className="lg:col-span-2 space-y-6">
            {role === 'HOST' && (
              <div className="space-y-6">
                <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl flex flex-col items-center space-y-4">
                  <div className="p-3 bg-white rounded-2xl shadow-xl">
                    <QRCodeSVG value={getQrUrl()} size={140} />
                  </div>
                  <p className="text-xs text-slate-400">Scan QR Code to Join Room <span className="text-indigo-400 font-mono font-bold">{roomCode}</span></p>
                  <button onClick={() => socketRef.current && socketRef.current.emit('RESET_BUZZER', { roomCode })} className="w-full py-3.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-2xl font-bold flex items-center justify-center space-x-2 text-indigo-300">
                    <RotateCcw className="w-4 h-4 text-indigo-400" />
                    <span>Reset All Buzzers (Next Round)</span>
                  </button>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-4">
                  <h3 className="text-xs font-bold uppercase text-slate-400 tracking-wider flex items-center space-x-2">
                    <Users className="w-4 h-4 text-indigo-400" />
                    <span>Create & Manage Teams</span>
                  </h3>
                  <form onSubmit={handleCreateTeam} className="flex space-x-3">
                    <input type="text" placeholder="Enter new team name" value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} className="flex-1 bg-slate-950 border border-slate-800 text-sm rounded-xl py-3 px-4 outline-none focus:border-indigo-500" />
                    <button type="submit" className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 font-bold rounded-xl text-xs flex items-center space-x-1 shadow-md">
                      <Plus className="w-4 h-4" />
                      <span>Add Team</span>
                    </button>
                  </form>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-3">
                  <h3 className="text-xs font-bold uppercase text-slate-400 tracking-wider flex items-center space-x-2">
                    <Volume2 className="w-4 h-4 text-indigo-400" />
                    <span>Live Speed Queue (Host Control)</span>
                  </h3>
                  {queue.length === 0 ? (
                    <p className="text-slate-500 text-sm py-6 text-center">Waiting for teams to buzz...</p>
                  ) : (
                    queue.map((item, index) => (
                      <div key={index} className={`flex justify-between items-center p-4 rounded-xl border ${index === 0 ? 'bg-amber-500/10 border-amber-500/40 text-amber-300' : 'bg-slate-950 border-slate-800'}`}>
                        <div className="flex items-center space-x-3">
                          <span className="font-mono font-bold">#{index + 1}</span>
                          <div>
                            <p className="font-bold">{item.teamName}</p>
                            <p className="text-xs text-slate-400">Buzzed by: {item.playerName}</p>
                          </div>
                        </div>
                        
                        {index === 0 && (
                          <div className="flex items-center space-x-2">
                            <button 
                              onClick={() => {
                                playSound('CORRECT');
                                socketRef.current && socketRef.current.emit('UPDATE_SCORE_AND_NEXT_QUESTION', { roomCode, teamName: item.teamName, delta: 5 });
                              }}
                              className="p-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/40 rounded-lg flex items-center space-x-1"
                              title="Correct (+5 pts)"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                              <span className="text-xs font-bold">+5</span>
                            </button>
                            <button 
                              onClick={() => {
                                playSound('WRONG');
                                socketRef.current && socketRef.current.emit('PASS_TO_NEXT', { roomCode });
                              }}
                              className="p-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/40 rounded-lg flex items-center space-x-1"
                              title="Wrong (Pass)"
                            >
                              <XCircle className="w-4 h-4" />
                              <span className="text-xs font-bold">Pass</span>
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {role === 'PARTICIPANT' && (
              <div className="flex flex-col items-center justify-center space-y-6">
                {!teamRef.current ? (
                  <div className="w-full bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-4">
                    <h3 className="text-sm font-extrabold text-indigo-300 uppercase tracking-wider text-center">Select Your Team</h3>
                    <p className="text-xs text-slate-400 text-center">Choose a team created by the host to join:</p>
                    
                    <div className="space-y-3 pt-2">
                      {Object.keys(teams).length === 0 ? (
                        <p className="text-slate-500 text-xs text-center py-6">No teams created by host yet. Please wait...</p>
                      ) : (
                        Object.entries(teams).map(([tName, data]) => (
                          <div key={tName} className="bg-slate-950 p-4 rounded-2xl border border-slate-800 flex items-center justify-between shadow-md">
                            <div>
                              <p className="font-bold text-sm text-white">{tName}</p>
                              <p className="text-xs text-slate-400 font-mono">{data.members.length} members joined</p>
                            </div>
                            <div className="flex items-center space-x-2">
                              <button onClick={() => setMembersModalTeam(tName)} className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700">
                                <Users className="w-4 h-4" />
                              </button>
                              <button onClick={() => handleJoinTeam(tName)} className="p-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl shadow-lg shadow-indigo-500/30 flex items-center space-x-1">
                                <Plus className="w-4 h-4" />
                                <span className="text-xs font-bold pr-1">Join</span>
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="w-full flex flex-col items-center space-y-6">
                    <div className="flex items-center justify-between w-full bg-slate-900 border border-slate-800 px-5 py-3 rounded-2xl">
                      <span className="font-bold text-sm text-indigo-300">Team: {teamRef.current}</span>
                      <div className="flex items-center space-x-2">
                        <button onClick={() => setMembersModalTeam(teamRef.current)} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-semibold flex items-center space-x-1.5">
                          <Users className="w-3.5 h-3.5 text-indigo-400" />
                          <span>Teammates</span>
                        </button>
                        <button onClick={handleLeaveTeam} className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-xl text-xs font-semibold flex items-center space-x-1">
                          <LogOut className="w-3.5 h-3.5" />
                          <span>Leave Team</span>
                        </button>
                      </div>
                    </div>

                    <button
                      onClick={handleBuzz}
                      onTouchStart={handleBuzz}
                      disabled={isBuzzedConfirmed}
                      className={`w-64 h-64 rounded-full border-8 select-none transition-transform active:scale-95 flex items-center justify-center shadow-2xl ${
                        isBuzzedConfirmed 
                          ? 'bg-slate-900 border-emerald-500/50 text-emerald-400 cursor-not-allowed pointer-events-none' 
                          : 'bg-gradient-to-b from-red-500 via-red-600 to-red-800 border-red-400 text-white shadow-red-900/80 active:translate-y-2 cursor-pointer'
                      }`}
                      style={{ 
                        boxShadow: isBuzzedConfirmed ? 'none' : '0 20px 50px rgba(220, 38, 38, 0.5)',
                        touchAction: 'manipulation'
                      }}
                    >
                      <div className="flex flex-col items-center space-y-1 select-none pointer-events-none">
                        {isBuzzedConfirmed ? (
                          <>
                            <Check className="w-10 h-10 text-emerald-400" />
                            <span className="text-3xl font-black text-emerald-400 font-mono">#{myRank}</span>
                            <span className="text-xs font-bold tracking-widest text-emerald-300 uppercase">PRESSED</span>
                          </>
                        ) : (
                          <span className="text-4xl font-black tracking-widest">BUZZ</span>
                        )}
                      </div>
                    </button>

                    <p className="text-xs text-slate-500">
                      {isBuzzedConfirmed ? `Your team buzzed in at Position #${myRank}! Waiting for host...` : 'Tap to claim response for your team!'}
                    </p>

                    <div className="w-full bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-3">
                      <h3 className="text-xs font-bold uppercase text-slate-400 tracking-wider flex items-center space-x-2">
                        <Volume2 className="w-4 h-4 text-indigo-400" />
                        <span>Live Speed Queue</span>
                      </h3>
                      {queue.length === 0 ? (
                        <p className="text-slate-500 text-xs py-4 text-center">Waiting for teams to buzz...</p>
                      ) : (
                        queue.map((item, index) => (
                          <div key={index} className={`flex justify-between items-center p-3 rounded-xl border ${item.teamName === teamRef.current ? 'bg-indigo-950/60 border-indigo-500/60 text-indigo-200' : index === 0 ? 'bg-amber-500/10 border-amber-500/40 text-amber-300' : 'bg-slate-950 border-slate-800'}`}>
                            <div className="flex items-center space-x-3">
                              <span className="font-mono font-bold text-sm">#{index + 1}</span>
                              <div>
                                <p className="font-bold text-sm flex items-center space-x-2">
                                  <span>{item.teamName}</span>
                                  {item.teamName === teamRef.current && (
                                    <span className="text-[10px] bg-indigo-500/30 text-indigo-300 px-1.5 py-0.5 rounded font-mono">YOUR TEAM</span>
                                  )}
                                </p>
                                <p className="text-[11px] text-slate-400">Buzzed by: {item.playerName}</p>
                              </div>
                            </div>
                            {index === 0 && (
                              <span className="text-[10px] font-extrabold bg-amber-500/20 text-amber-400 px-2 py-1 rounded-md uppercase tracking-wider">Active Turn</span>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Scoreboard */}
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-3">
              <h3 className="text-xs font-bold uppercase text-slate-400 tracking-wider flex items-center space-x-2">
                <Trophy className="w-4 h-4 text-amber-400" />
                <span>Scoreboard & Team Roster</span>
              </h3>
              <div className="grid grid-cols-1 gap-3">
                {Object.keys(teams).length === 0 ? (
                  <p className="text-slate-500 text-xs text-center py-2">No teams registered yet...</p>
                ) : (
                  Object.entries(teams).map(([name, data]) => (
                    <div key={name} className={`bg-slate-950 p-4 rounded-xl border space-y-3 ${name === teamRef.current ? 'border-indigo-500/50' : 'border-slate-800'}`}>
                      <div className="flex justify-between items-center cursor-pointer" onClick={() => toggleTeamExpand(name)}>
                        <div>
                          <p className="font-bold text-sm flex items-center space-x-2">
                            <span>{name}</span>
                            <span className="text-xs text-slate-500 font-normal">({data.members.length} members)</span>
                          </p>
                          <p className="text-xs text-indigo-400 font-mono font-bold">{data.score} pts</p>
                        </div>
                        
                        <div className="flex items-center space-x-2">
                          {role === 'HOST' && (
                            <div className="flex items-center space-x-1 mr-2" onClick={(e) => e.stopPropagation()}>
                              <button onClick={() => handleScoreChange(name, -5)} className="p-1 text-slate-400 hover:text-rose-400 bg-slate-900 rounded border border-slate-800" title="Deduct 5 pts">
                                <MinusCircle className="w-4 h-4" />
                              </button>
                              <button onClick={() => handleScoreChange(name, 5)} className="p-1 text-slate-400 hover:text-emerald-400 bg-slate-900 rounded border border-slate-800" title="Add 5 pts">
                                <PlusCircle className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                          {role === 'HOST' && (
                            <button onClick={(e) => { e.stopPropagation(); setConfirmModal({ open: true, type: 'TEAM', teamName: name, playerName: '' }); }} className="p-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg border border-rose-500/30">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                          <button className="text-slate-400 hover:text-white">
                            {expandedTeams[name] ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      {expandedTeams[name] && (
                        <div className="pt-2 border-t border-slate-900 space-y-2">
                          <p className="text-xs font-bold uppercase text-slate-500">Active Members</p>
                          <div className="flex flex-wrap gap-2">
                            {data.members.map((m, i) => (
                              <span key={i} className="px-3 py-1 bg-slate-900 border border-slate-800 rounded-lg text-xs font-semibold text-slate-300 flex items-center space-x-2">
                               <span>{m}</span>
                               {role === 'HOST' && (
                                 <button onClick={() => setConfirmModal({ open: true, type: 'PLAYER', teamName: name, playerName: m })} className="text-slate-500 hover:text-rose-400 ml-1">
                                   <UserMinus className="w-3 h-3" />
                                 </button>
                               )}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Activity Broadcast Panel */}
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-4 h-full sticky top-4 flex flex-col">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-xs font-bold uppercase text-slate-400 tracking-wider flex items-center space-x-2">
                  <Activity className="w-4 h-4 text-indigo-400" />
                  <span>Activity Broadcast</span>
                </h3>
                <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full font-mono">Live</span>
              </div>

              <div className="space-y-2.5 overflow-y-auto max-h-[500px] flex-1 pr-1">
                {activityLogs.length === 0 ? (
                  <p className="text-slate-500 text-xs text-center py-8">No activity recorded yet...</p>
                ) : (
                  activityLogs.map((log, index) => (
                    <div key={index} className="bg-slate-950 border border-slate-800/80 p-3 rounded-xl text-xs space-y-1 shadow-inner">
                      <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono">
                        <span className="text-indigo-400 font-bold">{log.type}</span>
                        <span>{log.time}</span>
                      </div>
                      <p className="text-slate-300 font-medium leading-relaxed">{log.message}</p>
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
        <div className="max-w-6xl mx-auto my-auto w-full space-y-6 py-4">
          <div className="flex justify-between items-center bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-xl">
            <div>
              <h2 className="text-xl font-black text-white flex items-center space-x-2">
                <Server className="w-6 h-6 text-indigo-400" />
                <span>System Room Control Center</span>
              </h2>
              <p className="text-xs text-slate-400">Real-time monitoring of active and closed rooms across the application.</p>
            </div>
            <button onClick={() => { setScreen('LANDING'); setRole(null); }} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-bold rounded-xl border border-slate-700">
              Exit Admin Access
            </button>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/50">
              <span className="text-xs font-extrabold uppercase tracking-wider text-slate-400">Total Tracked Rooms: {adminRoomsList.length}</span>
              <span className="text-[11px] text-emerald-400 font-mono font-bold">● LIVE UPDATING SOCKETS</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] uppercase text-slate-400 font-bold bg-slate-950">
                    <th className="p-4">Room ID</th>
                    <th className="p-4">Created By (Host)</th>
                    <th className="p-4">Host Pass</th>
                    <th className="p-4">Participant Pass</th>
                    <th className="p-4">Created Time</th>
                    <th className="p-4">Teams / Members</th>
                    <th className="p-4">Status</th>
                    <th className="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-xs font-medium">
                  {adminRoomsList.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-12 text-slate-500">No rooms created yet.</td>
                    </tr>
                  ) : (
                    adminRoomsList.map((r) => (
                      <tr key={r.roomCode} className="hover:bg-slate-800/50 transition-colors">
                        <td className="p-4 font-mono font-bold text-indigo-400">{r.roomCode}</td>
                        <td className="p-4 font-bold text-white">{r.hostName}</td>
                        <td className="p-4 font-mono text-amber-300">{r.hostPassword}</td>
                        <td className="p-4 font-mono text-emerald-300">{r.participantPassword}</td>
                        <td className="p-4 text-slate-400 text-[11px]">{r.createdAt}</td>
                        <td className="p-4 font-mono text-slate-300">{r.teamsCount} teams ({r.totalMembers} members)</td>
                        <td className="p-4">
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${r.status === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'}`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          {r.status === 'ACTIVE' && (
                            <button onClick={() => handleTerminateRoom(r.roomCode)} className="px-3 py-1.5 bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 border border-rose-500/40 rounded-lg text-xs font-bold">
                              Terminate
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

      <footer className="text-center text-xs text-slate-700 py-2">
        Developed by Tabres
      </footer>
    </div>
  );
}
