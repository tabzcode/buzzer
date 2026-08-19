'use client';

import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import { Trophy, RotateCcw, Zap, Users, ShieldAlert, Trash2, Server } from 'lucide-react';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

export default function BuzzerApp() {
  const [socket, setSocket] = useState(null);
  
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminAuth, setAdminAuth] = useState(false);
  const [adminPass, setAdminPass] = useState('');
  const [adminRooms, setAdminRooms] = useState([]);

  const [teamName, setTeamName] = useState('');
  const [userName, setUserName] = useState('');
  const [roomCode, setRoomCode] = useState('MAIN');
  const [isRegistered, setIsRegistered] = useState(false);
  const [queue, setQueue] = useState([]);
  const [hasPressed, setHasPressed] = useState(false);

  useEffect(() => {
    const savedTeam = localStorage.getItem('buzzer_teamName');
    const savedUser = localStorage.getItem('buzzer_userName');
    if (savedTeam) {
      setTeamName(savedTeam);
      setUserName(savedUser || '');
      setIsRegistered(true);
    }
  }, []);

  useEffect(() => {
    const newSocket = io(SOCKET_URL);
    setSocket(newSocket);

    newSocket.on('update-queue', (serverQueue) => {
      setQueue(serverQueue);
      const teamInQueue = serverQueue.some(item => item.teamName === teamName);
      setHasPressed(teamInQueue);
    });

    newSocket.on('admin-authenticated', (res) => {
      if (res.success) {
        setAdminAuth(true);
        setAdminRooms(res.rooms);
      } else {
        alert('Invalid Admin Password!');
      }
    });

    newSocket.on('player-kicked', (data) => {
      if (data.teamName === localStorage.getItem('buzzer_teamName')) {
        localStorage.clear();
        window.location.reload();
      }
    });

    return () => newSocket.disconnect();
  }, [teamName]);

  const handleRegister = (e) => {
    e.preventDefault();
    if (isAdmin) {
      socket.emit('admin-login', { username: 'admin', password: adminPass });
    } else if (teamName.trim()) {
      const trimmedTeam = teamName.trim();
      const trimmedUser = userName.trim();
      localStorage.setItem('buzzer_teamName', trimmedTeam);
      localStorage.setItem('buzzer_userName', trimmedUser);
      setIsRegistered(true);
      socket.emit('join-room', { roomCode, teamName: trimmedTeam, userName: trimmedUser });
    }
  };

  const handlePressBuzzer = () => {
    if (!hasPressed && socket && teamName) {
      setHasPressed(true); // Instant local state change (no lag)
      socket.emit('press-buzzer', { roomCode, teamName, userName });
    }
  };

  const handleReset = () => {
    if (socket) socket.emit('reset-buzzer', { roomCode });
  };

  const handleKickPlayer = (targetTeam) => {
    if (socket) socket.emit('admin-kick-player', { roomCode, teamName: targetTeam });
  };

  if (isAdmin && adminAuth) {
    return (
      <main className="min-h-screen bg-slate-950 text-white p-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex justify-between items-center bg-slate-900 p-4 rounded-xl border border-red-500/30 mb-8">
            <div className="flex items-center gap-3">
              <ShieldAlert className="text-red-500" size={32} />
              <div>
                <h1 className="text-xl font-bold text-red-400">Root Admin Dashboard</h1>
                <p className="text-xs text-slate-400">Creator Mode (Hidden from queue)</p>
              </div>
            </div>
            <button onClick={() => window.location.reload()} className="bg-slate-800 text-xs px-3 py-2 rounded-lg text-slate-300">Exit Admin Mode</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-slate-900 p-5 rounded-xl border border-slate-800">
              <h2 className="font-bold flex items-center gap-2 mb-4 text-slate-200">
                <Server size={18} className="text-yellow-400" /> Active Rooms
              </h2>
              {adminRooms.map((rm, idx) => (
                <div key={idx} className="bg-slate-950 p-3 rounded-lg border border-slate-800 mb-2">
                  <p className="font-bold text-yellow-400">Room Code: {rm.code}</p>
                  <p className="text-xs text-slate-400">Host: {rm.hostName}</p>
                  <p className="text-xs text-slate-400">Players Joined: {rm.playerCount}</p>
                </div>
              ))}
            </div>

            <div className="md:col-span-2 bg-slate-900 p-5 rounded-xl border border-slate-800">
              <div className="flex justify-between items-center mb-4">
                <h2 className="font-bold flex items-center gap-2 text-slate-200">
                  <Trophy size={18} className="text-yellow-400" /> Live Queue (Room: {roomCode})
                </h2>
                <button onClick={handleReset} className="bg-red-600 hover:bg-red-500 text-xs text-white px-3 py-1.5 rounded-lg flex items-center gap-1">
                  <RotateCcw size={14} /> Clear Round Queue
                </button>
              </div>

              {queue.length === 0 ? (
                <p className="text-sm text-slate-500 py-8 text-center">No buzzes recorded for this round yet.</p>
              ) : (
                <div className="space-y-2">
                  {queue.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-slate-950 p-3 rounded-lg border border-slate-800">
                      <div>
                        <span className="font-bold text-yellow-400 mr-2">#{idx + 1}</span>
                        <span className="font-semibold">{item.teamName}</span>
                        {item.userName && <span className="text-xs text-slate-400 ml-2">({item.userName})</span>}
                      </div>
                      <button onClick={() => handleKickPlayer(item.teamName)} className="text-slate-500 hover:text-red-400 p-1">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (!isRegistered && !adminAuth) {
    return (
      <main className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-4">
        <div className="bg-slate-800 p-8 rounded-2xl shadow-xl max-w-md w-full border border-slate-700">
          <div className="flex items-center justify-center mb-6 text-yellow-400">
            <Zap size={48} />
          </div>
          <h1 className="text-2xl font-bold text-center mb-2">Office Buzzer Arena</h1>
          
          <div className="flex justify-center gap-4 mb-6 text-xs">
            <button type="button" onClick={() => setIsAdmin(false)} className={`pb-1 ${!isAdmin ? 'border-b-2 border-yellow-400 font-bold text-white' : 'text-slate-400'}`}>Player Join</button>
            <button type="button" onClick={() => setIsAdmin(true)} className={`pb-1 ${isAdmin ? 'border-b-2 border-red-500 font-bold text-red-400' : 'text-slate-400'}`}>Admin / Host Login</button>
          </div>

          <form onSubmit={handleRegister} className="space-y-4">
            {isAdmin ? (
              <>
                <div>
                  <label className="block text-sm text-slate-300 mb-1">Username</label>
                  <input type="text" readOnly value="admin" className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-400" />
                </div>
                <div>
                  <label className="block text-sm text-slate-300 mb-1">Root Password</label>
                  <input type="password" required value={adminPass} onChange={(e) => setAdminPass(e.target.value)} placeholder="Enter password (9676)" className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white" />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-sm text-slate-300 mb-1">Team Name *</label>
                  <input type="text" required value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="e.g. Alpha Team" className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white" />
                </div>
                <div>
                  <label className="block text-sm text-slate-300 mb-1">Your Name (Optional)</label>
                  <input type="text" value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="e.g. Ravi" className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white" />
                </div>
              </>
            )}

            <button type="submit" className={`w-full py-3 font-bold rounded-lg transition-all shadow-lg ${isAdmin ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-yellow-500 hover:bg-yellow-400 text-slate-950'}`}>
              {isAdmin ? 'Access Admin Control' : 'Enter Room'}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-900 text-white p-4 md:p-8 flex flex-col items-center">
      <div className="max-w-4xl w-full flex justify-between items-center mb-6 bg-slate-800 px-6 py-3 rounded-xl border border-slate-700">
        <div>
          <span className="text-xs text-slate-400 block">Logged in as Team</span>
          <span className="font-bold text-yellow-400 text-lg">{teamName}</span> {userName && <span className="text-slate-400 text-sm">({userName})</span>}
        </div>
        <span className="text-xs bg-slate-900 text-slate-400 px-3 py-1.5 rounded-lg border border-slate-700">Locked Session</span>
      </div>

      <div className="max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
        <div className="flex flex-col items-center justify-center bg-slate-800 p-8 rounded-2xl border border-slate-700 shadow-xl">
          <button onClick={handlePressBuzzer} disabled={hasPressed} className={`w-48 h-48 rounded-full flex flex-col items-center justify-center font-black text-2xl shadow-2xl transition-all ${hasPressed ? 'bg-red-600 opacity-80 cursor-not-allowed' : 'bg-gradient-to-br from-yellow-400 to-amber-600 text-slate-950 animate-pulse'}`}>
            <Zap size={40} className="mb-2" />
            {hasPressed ? 'BUZZED!' : 'PRESS!'}
          </button>
          <p className="mt-6 text-xs text-slate-400 text-center">{hasPressed ? 'Your response is logged in the queue!' : 'Tap fast to secure your position!'}</p>
        </div>

        <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 h-[420px] flex flex-col">
          <div className="flex items-center justify-between mb-4 border-b border-slate-700 pb-3">
            <div className="flex items-center gap-2">
              <Trophy className="text-yellow-400" size={20} />
              <h3 className="font-bold text-lg">Live Response Order</h3>
            </div>
            <span className="text-xs bg-slate-700 px-2 py-1 rounded text-slate-300">{queue.length} Buzzed</span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3">
            {queue.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 text-center">
                <Users size={32} className="mb-2 opacity-40" />
                <p>No answers yet this round.<br />Be the first team to buzz!</p>
              </div>
            ) : (
              queue.map((item, index) => (
                <div key={index} className={`flex items-center justify-between p-3 rounded-xl border ${index === 0 ? 'bg-yellow-500/10 border-yellow-500/40 text-yellow-300' : 'bg-slate-900/50 border-slate-700/50 text-slate-200'}`}>
                  <div className="flex items-center gap-3">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${index === 0 ? 'bg-yellow-500 text-slate-950' : 'bg-slate-700 text-slate-300'}`}>{index + 1}</span>
                    <div>
                      <p className="font-semibold">{item.teamName}</p>
                      {item.userName && <p className="text-xs text-slate-400">by {item.userName}</p>}
                    </div>
                  </div>
                  <span className="text-xs text-slate-400 font-mono">{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 })}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
