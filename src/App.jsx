import React, { useState, useRef } from 'react';
import { io } from 'socket.io-client';
import { Device } from 'mediasoup-client';

const socket = io('https://hcmbackend-cka0.onrender.com');

function App() {
  const [roomId, setRoomId] = useState('');
  const [joinedRoom, setJoinedRoom] = useState(null);
  const [inputRoomId, setInputRoomId] = useState('');
  const videoRef = useRef(null);
  const deviceRef = useRef(null);
  const sendTransportRef = useRef(null);

  const handleCreateRoom = () => {
    const newRoomId = Math.random().toString(36).substring(2, 8);
    setRoomId(newRoomId);
    setJoinedRoom(newRoomId)
    joinRoom(newRoomId);
  };

  const handleJoinRoom = () => {
    if (inputRoomId.trim()) {
      setRoomId(inputRoomId.trim());
      joinRoom(inputRoomId.trim());
    }
  };

  const joinRoom = async (roomIdToJoin) => {
    socket.emit('joinRoom', { roomId: roomIdToJoin }, async (routerRtpCapabilities) => {
      const device = new Device();
      await device.load({ routerRtpCapabilities });
      deviceRef.current = device;

      socket.emit('createSendTransport', { roomId: roomIdToJoin }, async (transportOptions) => {
        const sendTransport = device.createSendTransport(transportOptions);
        sendTransportRef.current = sendTransport;

        sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
          socket.emit('connectTransport', { dtlsParameters, roomId: roomIdToJoin }, callback);
        });

        sendTransport.on('produce', ({ kind, rtpParameters }, callback, errback) => {
          socket.emit('produce', { kind, rtpParameters, roomId: roomIdToJoin }, ({ id }) => {
            callback({ id });
          });
        });

        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        videoRef.current.srcObject = stream;

        for (const track of stream.getTracks()) {
          await sendTransport.produce({ track });
        }

        setJoinedRoom(roomIdToJoin);
      });
    });
  };

  return (
    <div style={{ padding: '2rem' }}>
      <h1>Mediasoup Room</h1>

      <button onClick={handleCreateRoom}>Create Room</button>
      <div style={{ marginTop: '1rem' }}>
        <input
          type="text"
          placeholder="Enter Room ID"
          value={inputRoomId}
          onChange={(e) => setInputRoomId(e.target.value)}
        />
        <button onClick={handleJoinRoom}>Join Room</button>
      </div>

      <h2>Current Room ID: {joinedRoom || 'None'}</h2>
      <video ref={videoRef} autoPlay muted playsInline style={{ width: '500px', border: '1px solid black' }} />
      <div className="id">ID</div>
    </div>
  );
}

export default App;
