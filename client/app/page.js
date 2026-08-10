'use client';
import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';
import { Shield, Users, RotateCcw, CheckCircle2, XCircle, Sparkles, Volume2, Trophy, Lock, Check, UserMinus, Trash2, ChevronDown, ChevronUp, AlertTriangle, LogOut, Info, KeyRound, Plus, UserPlus, Activity, ArrowLeft } from 'lucide-react';
let socket;

export default function App() {
    useEffect(() => {
  socket = io("https://buzzer-n9va.onrender.com");
}, []);
  const [screen, setScreen] = useState('LANDING'); // 'LANDING', 'CREATE_FORM', 'JOIN_HOST_FORM', 'JOIN_PARTICIPANT_FORM', 'GAME'
  const [role, setRole] = useState(null); // 'HOST' or 'PARTICIPANT'
  const [roomCode, setRoomCode] = useState('');
  
  // Create Room Form State
  const [hostName, setHostName] = useState('');
  const [hostPassword, setHostPassword] = useState('');
  const [participantPassword, setParticipantPassword] = useState('');

  // Join Form State
  const [enteredRoomCode, setEnteredRoomCode] = useState('');
  const [enteredName, setEnteredName] = useState('');
  const [enteredPassword, setEnteredPassword] = useState('');

  // Host Team Creation State
  const [newTeamName, setNewTeamName] = useState('');

  // App Data State
  const [teams, setTeams] = useState({});
  const [queue, setQueue] = useState([]);
  const [activityLogs, setActivityLogs] = useState([]);
  const [expandedTeams, setExpandedTeams] = useState({});
  const [membersModalTeam, setMembersModalTeam] = useState(null);
  
  // Modals & Notifications
  const [confirmModal, setConfirmModal] = useState({ open: false, type: '', teamName: '', playerName: '' });
  const [kickedNotice, setKickedNotice] = useState('');
  const [toastMessage, setToastMessage] = useState('');

  const socketRef = useRef(null);
  const teamRef = useRef('');
  const playerRef = useRef('');
  const roleRef = useRef(role);

  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  // Check URL query params on load for QR code auto-fill
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const qRoom = params.get('room');
      if (qRoom) {
        setEnteredRoomCode(qRoom);
      }
    }
  }, []);

  useEffect(() => {
    socketRef.current = io("https://buzzer-n9va.onrender.com", { 
      forceNew: true,
      multiplex: false,
      transports: ['websocket', 'polling']
    });

    socketRef.current.on('ROOM_CREATED', ({ roomCode, logs }) => {
      setRoomCode(roomCode);
      setEnteredName(hostName);
      setRole('HOST');
      setScreen('GAME');
      if (logs) setActivityLogs(logs);
    });

    socketRef.current.on('HOST_JOIN_SUCCESS', ({ roomCode, teams, queue, logs }) => {
      setRoomCode(roomCode);
      setTeams(teams || {});
      setQueue(queue || []);
      setRole('HOST');
      setScreen('GAME');
      if (logs) setActivityLogs(logs);
    });

    socketRef.current.on('JOIN_SUCCESS', ({ roomCode: joinedRoom, teamName: joinedTeam, teams, logs }) => {
      setRoomCode(joinedRoom);
      teamRef.current = joinedTeam;
      setTeams(teams);
      setRole('PARTICIPANT');
      setScreen('GAME');
      if (logs) setActivityLogs(logs);
    });

    socketRef.current.on('ERROR', ({ message }) => {
      alert(message);
    });

    socketRef.current.on('TEAMS_UPDATED', (updatedTeams) => setTeams(updatedTeams));

    socketRef.current.on('BUZZER_QUEUE_UPDATED', ({ queue }) => {
      setQueue(queue);
    });

    socketRef.current.on('BUZZER_RESET', () => {
      setQueue([]);
    });

    socketRef.current.on('ACTIVITY_LOGS_UPDATED', (logs) => {
      setActivityLogs(logs);
    });

    socketRef.current.on('HOST_ACTION_NOTICE', ({ message }) => {
      setToastMessage(message);
      setTimeout(() => setToastMessage(''), 4000);
    });

    socketRef.current.on('TEAM_REMOVED', ({ teamName: removedTeam }) => {
      if (roleRef.current === 'PARTICIPANT' && teamRef.current === removedTeam) {
        setKickedNotice('Host has removed your team from the room.');
        setScreen('LANDING');
        setRole(null);
        teamRef.current = '';
      }
    });

    socketRef.current.on('PLAYER_REMOVED', ({ teamName: tName, playerName: pName }) => {
      if (
        roleRef.current === 'PARTICIPANT' && 
        teamRef.current === tName && 
        playerRef.current === pName
      ) {
        setKickedNotice('Host has removed you from the team.');
        setScreen('LANDING');
        setRole(null);
        teamRef.current = '';
      }
    });

    socketRef.current.on('KICKED_OUT', ({ message }) => {
      setKickedNotice(message);
      setScreen('LANDING');
      setRole(null);
      teamRef.current = '';
    });

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, [hostName]);

  // Handlers for Form Actions
  const handleCreateRoomSubmit = (e) => {
    e.preventDefault();
    if (!hostName || !hostPassword || !participantPassword) {
      return alert('Please fill in all fields!');
    }
    if (hostPassword.length !== 4 || participantPassword.length !== 4) {
      return alert('Both Host and Participant passwords must be exactly 4 characters long!');
    }
    if (hostPassword === participantPassword) {
      return alert('Host Password and Participant Password CANNOT be the same!');
    }
    const joinMethod = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('room') ? 'QR Code' : 'Manual ID';
    socketRef.current.emit('CREATE_ROOM', { hostName, hostPassword, participantPassword, joinMethod });
  };

  const handleJoinHostSubmit = (e) => {
    e.preventDefault();
    const isQr = typeof window !== 'undefined' && !!new URLSearchParams(window.location.search).get('room');
    const targetRoom = isQr ? new URLSearchParams(window.location.search).get('room') : enteredRoomCode;

    if (!targetRoom || !enteredName || !enteredPassword) {
      return alert('Please fill in all required fields!');
    }
    if (enteredPassword.length !== 4) {
      return alert('Password must be exactly 4 characters long!');
    }
    socketRef.current.emit('JOIN_AS_HOST', { roomCode: targetRoom, hostName: enteredName, hostPassword: enteredPassword, joinMethod: isQr ? 'QR Code' : 'Room ID' });
  };

  const handleJoinParticipantSubmit = (e) => {
    e.preventDefault();
    const isQr = typeof window !== 'undefined' && !!new URLSearchParams(window.location.search).get('room');
    const targetRoom = isQr ? new URLSearchParams(window.location.search).get('room') : enteredRoomCode;

    if (!targetRoom || !enteredName || !enteredPassword) {
      return alert('Please fill in all required fields!');
    }
    if (enteredPassword.length !== 4) {
      return alert('Password must be exactly 4 characters long!');
    }
    playerRef.current = enteredName;
    socketRef.current.emit('JOIN_ROOM_INITIAL', { roomCode: targetRoom, playerName: enteredName, participantPassword: enteredPassword, joinMethod: isQr ? 'QR Code' : 'Room ID' });
  };

  const handleCreateTeam = (e) => {
    e.preventDefault();
    if (!newTeamName.trim()) return;
    socketRef.current.emit('CREATE_TEAM', { roomCode, teamName: newTeamName.trim() });
    setNewTeamName('');
  };

  const handleJoinTeam = (targetTeamName) => {
    teamRef.current = targetTeamName;
    socketRef.current.emit('JOIN_TEAM_SPECIFIC', { roomCode, teamName: targetTeamName, playerName: enteredName });
  };

  const toggleTeamExpand = (tName) => {
    setExpandedTeams((prev) => ({ ...prev, [tName]: !prev[tName] }));
  };

  const hasTeamBuzzed = queue.some((item) => item.teamName === teamRef.current);

  const handleBuzz = () => {
    if (hasTeamBuzzed || !socketRef.current || !teamRef.current) return;
    if (navigator.vibrate) navigator.vibrate(100);
    socketRef.current.emit('PRESS_BUZZER', { roomCode, teamName: teamRef.current, playerName: enteredName });
  };

  const confirmAction = () => {
    if (!socketRef.current) return;
    if (confirmModal.type === 'PLAYER') {
      socketRef.current.emit('REMOVE_PLAYER', { roomCode, teamName: confirmModal.teamName, playerName: confirmModal.playerName });
    } else if (confirmModal.type === 'TEAM') {
      socketRef.current.emit('REMOVE_TEAM', { roomCode, teamName: confirmModal.teamName });
    }
    setConfirmModal({ open: false, type: '', teamName: '', playerName: '' });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 font-sans selection:bg-indigo-500 relative">
      
      {toastMessage && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 animate-bounce duration-300">
          <div className="bg-slate-900 border border-indigo-500/80 text-indigo-200 px-5 py-2.5 rounded-xl shadow-2xl shadow-indigo-950/50 flex items-center space-x-3 backdrop-blur-md">
            <Info className="w-4 h-4 text-indigo-400 shrink-0" />
            <span className="text-xs font-semibold tracking-wide">{toastMessage}</span>
          </div>
        </div>
      )}

      {kickedNotice && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-rose-600/90 border border-rose-500 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center space-x-3 backdrop-blur-md">
          <LogOut className="w-5 h-5" />
          <span className="text-sm font-bold">{kickedNotice}</span>
          <button onClick={() => setKickedNotice('')} className="ml-4 text-xs bg-rose-800 hover:bg-rose-700 px-2 py-1 rounded-lg">
            Dismiss
          </button>
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
                ? `Are you sure you want to remove player "${confirmModal.playerName}" from team "${confirmModal.teamName}"?`
                : `Are you sure you want to remove team "${confirmModal.teamName}" and all its members?`}
            </p>
            <div className="flex space-x-3 pt-2">
              <button 
                onClick={() => setConfirmModal({ open: false, type: '', teamName: '', playerName: '' })}
                className="w-1/2 py-3 bg-slate-800 hover:bg-slate-700 font-bold text-xs rounded-xl border border-slate-700"
              >
                Cancel
              </button>
              <button 
                onClick={confirmAction}
                className="w-1/2 py-3 bg-rose-600 hover:bg-rose-500 font-bold text-xs rounded-xl shadow-lg shadow-rose-600/30 text-white"
              >
                Yes, Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Members Popup Modal for Participants */}
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
            <button 
              onClick={() => setMembersModalTeam(null)}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-xs font-bold rounded-xl border border-slate-700"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* HEADER */}
      <header className="flex justify-between items-center pb-4 border-b border-slate-800">
        <div className="flex items-center space-x-2">
          <div className="p-2 bg-indigo-600 rounded-xl">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <h1 className="font-extrabold text-lg tracking-wider">BUZZER<span className="text-indigo-400">PRO</span></h1>
        </div>

        {roomCode && (
          <div className="bg-slate-900 border border-slate-700 px-4 py-2 rounded-2xl text-right flex flex-col items-end shadow-md">
            <div className="text-xs font-mono text-slate-400">
              ROOM: <span className="text-indigo-400 font-bold">{roomCode}</span>
            </div>
            <div className="text-sm font-bold text-white leading-tight">
              {role === 'HOST' ? enteredName || 'Host' : enteredName || 'Participant'}
            </div>
            <div className="text-[10px] font-extrabold tracking-wider text-amber-400 uppercase">
              {role === 'HOST' ? 'HOST' : teamRef.current || 'NO TEAM'}
            </div>
          </div>
        )}
      </header>

      {/* SCREEN 1: LANDING WITH 3 MAIN BUTTONS */}
      {screen === 'LANDING' && (
        <div className="max-w-md mx-auto my-auto w-full space-y-6 text-center">
          <h2 className="text-3xl font-extrabold">Trivia Arena</h2>
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-4 shadow-2xl">
            <p className="text-xs text-slate-400 uppercase font-bold tracking-wider mb-2">Select Your Option</p>

            <button 
              onClick={() => setScreen('CREATE_FORM')}
              className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 font-bold rounded-2xl flex items-center justify-center space-x-2 shadow-lg shadow-indigo-500/20 text-sm transition-all"
            >
              <Shield className="w-5 h-5" />
              <span>Create Room (Host)</span>
            </button>

            <div className="flex space-x-3 pt-2">
              <button 
                onClick={() => setScreen('JOIN_HOST_FORM')}
                className="w-1/2 py-3.5 bg-indigo-950 hover:bg-indigo-900 border border-indigo-700/60 font-bold text-xs rounded-xl flex items-center justify-center space-x-1.5 text-indigo-300 shadow-md transition-all"
              >
                <Shield className="w-4 h-4 text-indigo-400" />
                <span>Join as Host</span>
              </button>

              <button 
                onClick={() => setScreen('JOIN_PARTICIPANT_FORM')}
                className="w-1/2 py-3.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 font-bold text-xs rounded-xl flex items-center justify-center space-x-1.5 text-slate-200 shadow-md transition-all"
              >
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
              <input 
                type="text" 
                placeholder="Enter your name" 
                value={hostName}
                onChange={(e) => setHostName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 text-sm rounded-xl py-3 px-4 outline-none focus:border-indigo-500"
                required
              />
            </div>

            <div>
              <label className="text-xs font-bold uppercase text-slate-400 block mb-1">Host Password (Exactly 4 Chars)</label>
              <div className="relative">
                <input 
                  type="password" 
                  maxLength={4}
                  placeholder="4-digit password" 
                  value={hostPassword}
                  onChange={(e) => setHostPassword(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 text-sm rounded-xl py-3 px-4 outline-none focus:border-indigo-500 pr-10 tracking-widest font-mono"
                  required
                />
                <Lock className="w-4 h-4 text-indigo-400 absolute right-3 top-3.5" />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold uppercase text-slate-400 block mb-1">Participant Password (Exactly 4 Chars)</label>
              <div className="relative">
                <input 
                  type="password" 
                  maxLength={4}
                  placeholder="4-digit password" 
                  value={participantPassword}
                  onChange={(e) => setParticipantPassword(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 text-sm rounded-xl py-3 px-4 outline-none focus:border-indigo-500 pr-10 tracking-widest font-mono"
                  required
                />
                <KeyRound className="w-4 h-4 text-emerald-400 absolute right-3 top-3.5" />
              </div>
            </div>

            <button 
              type="submit"
              className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 font-bold rounded-2xl flex items-center justify-center space-x-2 shadow-lg shadow-indigo-500/20 text-sm mt-2"
            >
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
            <div>
              <label className="text-xs font-bold uppercase text-slate-400 block mb-1">Host Name</label>
              <input 
                type="text" 
                placeholder="Enter your name" 
                value={enteredName}
                onChange={(e) => setEnteredName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 text-sm rounded-xl py-3 px-4 outline-none focus:border-indigo-500"
                required
              />
            </div>

            {/* Hide Room ID if joined via QR code */}
            {!(typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('room')) && (
              <div>
                <label className="text-xs font-bold uppercase text-slate-400 block mb-1">Room ID</label>
                <input 
                  type="text" 
                  placeholder="6-Digit Room Code" 
                  value={enteredRoomCode}
                  onChange={(e) => setEnteredRoomCode(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 text-base font-mono rounded-xl py-3 px-4 outline-none focus:border-indigo-500"
                  required
                />
              </div>
            )}

            <div>
              <label className="text-xs font-bold uppercase text-slate-400 block mb-1">Host Password (4 Chars)</label>
              <input 
                type="password" 
                maxLength={4}
                placeholder="4-digit host password" 
                value={enteredPassword}
                onChange={(e) => setEnteredPassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 text-sm rounded-xl py-3 px-4 outline-none focus:border-indigo-500 tracking-widest font-mono"
                required
              />
            </div>

            <button 
              type="submit"
              className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 font-bold rounded-2xl flex items-center justify-center space-x-2 shadow-lg shadow-indigo-500/20 text-sm mt-2"
            >
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
              <input 
                type="text" 
                placeholder="Enter your name" 
                value={enteredName}
                onChange={(e) => setEnteredName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 text-sm rounded-xl py-3 px-4 outline-none focus:border-indigo-500"
                required
              />
            </div>

            {/* Hide Room ID if joined via QR code */}
            {!(typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('room')) && (
              <div>
                <label className="text-xs font-bold uppercase text-slate-400 block mb-1">Room ID</label>
                <input 
                  type="text" 
                  placeholder="6-Digit Room Code" 
                  value={enteredRoomCode}
                  onChange={(e) => setEnteredRoomCode(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 text-base font-mono rounded-xl py-3 px-4 outline-none focus:border-indigo-500"
                  required
                />
              </div>
            )}

            <div>
              <label className="text-xs font-bold uppercase text-slate-400 block mb-1">Participant Password (4 Chars)</label>
              <input 
                type="password" 
                maxLength={4}
                placeholder="4-digit participant password" 
                value={enteredPassword}
                onChange={(e) => setEnteredPassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 text-sm rounded-xl py-3 px-4 outline-none focus:border-indigo-500 tracking-widest font-mono"
                required
              />
            </div>

            <button 
              type="submit"
              className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 font-bold rounded-2xl flex items-center justify-center space-x-2 shadow-lg shadow-emerald-500/20 text-sm mt-2 text-white"
            >
              <UserPlus className="w-4 h-4" />
              <span>Continue to Team Selection</span>
            </button>
          </form>
        </div>
      )}

      {/* SCREEN 2: GAME & BROADCAST DASHBOARD */}
      {screen === 'GAME' && (
        <div className="max-w-6xl mx-auto my-auto w-full grid grid-cols-1 lg:grid-cols-3 gap-6 py-4">
          
          {/* LEFT / CENTER: MAIN GAME CONTROLS (2 Cols on Large screens) */}
          <div className="lg:col-span-2 space-y-6">
            {role === 'HOST' && (
              <div className="space-y-6">
                {/* QR Code & Reset Box */}
                <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl flex flex-col items-center space-y-4">
                  <div className="p-3 bg-white rounded-2xl shadow-xl">
                    <QRCodeSVG value={`https://${typeof window !== 'undefined' ? window.location.host : ''}?room=${roomCode}`} size={140} />
                  </div>
                  <p className="text-xs text-slate-400">Scan QR Code to Join Room <span className="text-indigo-400 font-mono font-bold">{roomCode}</span></p>
                  <button 
                    onClick={() => socketRef.current && socketRef.current.emit('RESET_BUZZER', { roomCode })}
                    className="w-full py-3.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-2xl font-bold flex items-center justify-center space-x-2 text-indigo-300"
                  >
                    <RotateCcw className="w-4 h-4 text-indigo-400" />
                    <span>Reset All Buzzers</span>
                  </button>
                </div>

                {/* Host Team Creation Panel */}
                <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-4">
                  <h3 className="text-xs font-bold uppercase text-slate-400 tracking-wider flex items-center space-x-2">
                    <Users className="w-4 h-4 text-indigo-400" />
                    <span>Create & Manage Teams</span>
                  </h3>
                  <form onSubmit={handleCreateTeam} className="flex space-x-3">
                    <input 
                      type="text" 
                      placeholder="Enter new team name (e.g. Team Titans)" 
                      value={newTeamName}
                      onChange={(e) => setNewTeamName(e.target.value)}
                      className="flex-1 bg-slate-950 border border-slate-800 text-sm rounded-xl py-3 px-4 outline-none focus:border-indigo-500"
                    />
                    <button type="submit" className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 font-bold rounded-xl text-xs flex items-center space-x-1 shadow-md">
                      <Plus className="w-4 h-4" />
                      <span>Add Team</span>
                    </button>
                  </form>
                </div>

                {/* Live Speed Queue */}
                <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-3">
                  <h3 className="text-xs font-bold uppercase text-slate-400 tracking-wider flex items-center space-x-2">
                    <Volume2 className="w-4 h-4 text-indigo-400" />
                    <span>Live Speed Queue</span>
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
                              onClick={() => socketRef.current && socketRef.current.emit('UPDATE_SCORE_AND_NEXT_QUESTION', { roomCode, teamName: item.teamName, delta: 5 })}
                              className="p-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/40 rounded-lg"
                              title="Correct (+5 pts)"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => socketRef.current && socketRef.current.emit('PASS_TO_NEXT', { roomCode })}
                              className="p-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/40 rounded-lg"
                              title="Wrong (Pass)"
                            >
                              <XCircle className="w-4 h-4" />
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
                  /* Team Selection View for Participants */
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
                              {/* Members Icon Button */}
                              <button 
                                onClick={() => setMembersModalTeam(tName)}
                                className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700"
                                title="View Team Members"
                              >
                                <Users className="w-4 h-4" />
                              </button>
                              {/* Plus Icon Button to Join Team */}
                              <button 
                                onClick={() => handleJoinTeam(tName)}
                                className="p-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl shadow-lg shadow-indigo-500/30 flex items-center space-x-1"
                                title="Join Team"
                              >
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
                  /* Active Buzzer View once team is selected */
                  <div className="w-full flex flex-col items-center space-y-6">
                    <div className="flex items-center justify-between w-full bg-slate-900 border border-slate-800 px-5 py-3 rounded-2xl">
                      <span className="font-bold text-sm text-indigo-300">Team: {teamRef.current}</span>
                      <button 
                        onClick={() => setMembersModalTeam(teamRef.current)} 
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-semibold flex items-center space-x-1.5"
                      >
                        <Users className="w-3.5 h-3.5 text-indigo-400" />
                        <span>View Teammates</span>
                      </button>
                    </div>

                    <button
                      onClick={handleBuzz}
                      disabled={hasTeamBuzzed}
                      className={`w-64 h-64 rounded-full border-8 transition-all transform active:scale-95 flex items-center justify-center shadow-2xl ${
                        hasTeamBuzzed 
                          ? 'bg-slate-900 border-emerald-500/50 text-emerald-400 cursor-not-allowed' 
                          : 'bg-gradient-to-b from-red-500 via-red-600 to-red-800 border-red-400 text-white shadow-red-900/80 active:translate-y-2'
                      }`}
                      style={{ boxShadow: hasTeamBuzzed ? 'none' : '0 20px 50px rgba(220, 38, 38, 0.5)' }}
                    >
                      <div className="flex flex-col items-center space-y-2">
                        {hasTeamBuzzed ? (
                          <>
                            <Check className="w-12 h-12 text-emerald-400" />
                            <span className="text-2xl font-extrabold tracking-widest text-emerald-400">PRESSED</span>
                          </>
                        ) : (
                          <span className="text-4xl font-black tracking-widest">BUZZ</span>
                        )}
                      </div>
                    </button>

                    <p className="text-xs text-slate-500">
                      {hasTeamBuzzed ? 'Your team has buzzed in! Waiting for host response...' : 'Tap to claim response for your team!'}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Scoreboard & Team Roster */}
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
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmModal({ open: true, type: 'TEAM', teamName: name, playerName: '' });
                              }}
                              className="p-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg border border-rose-500/30"
                              title="Delete Team"
                            >
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
                                 <button 
                                   onClick={() => setConfirmModal({ open: true, type: 'PLAYER', teamName: name, playerName: m })}
                                   className="text-slate-500 hover:text-rose-400 ml-1"
                                   title={`Remove ${m}`}
                                 >
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

          {/* RIGHT SIDE: LIVE BROADCASTING ACTIVITY PANEL */}
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

      <footer className="text-center text-xs text-slate-700 py-2">
        Developed by Tabres
      </footer>
    </div>
  );
}