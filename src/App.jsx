import React, { useState, useRef, useEffect } from 'react';
import { io } from 'socket.io-client';
import { Device } from 'mediasoup-client';

const socket = io('https://demov2.humanmaximizer.com/', {
  transports: ['websocket'],
});

const VideoPlayer = ({ stream }) => {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={false}
      style={{ width: 300, margin: 10, border: '1px solid black' }}
    />
  );
};

function App() {
  const [roomId, setRoomId] = useState('');
  const [joinedRoom, setJoinedRoom] = useState(null);
  const [inputRoomId, setInputRoomId] = useState('');
  const [remoteStreams, setRemoteStreams] = useState([]);
  const localVideoRef = useRef(null);
  const deviceRef = useRef(null);
  const sendTransportRef = useRef(null);
  const recvTransportRef = useRef(null);

  const handleCreateRoom = () => {
    const newRoomId = Math.random().toString(36).substring(2, 8);
    setRoomId(newRoomId);
    setJoinedRoom(newRoomId);
    joinRoom(newRoomId);
  };

  const handleJoinRoom = () => {
    if (inputRoomId.trim()) {
      setRoomId(inputRoomId.trim());
      joinRoom(inputRoomId.trim());
    }
  };

  const joinRoom = async (roomIdToJoin) => {
    socket.emit('joinRoom', { roomId: roomIdToJoin }, async (routerRtpCapabilities, existingProducers) => {
      const device = new Device();
      await device.load({ routerRtpCapabilities });
      deviceRef.current = device;

      // Send transport
      socket.emit('createSendTransport', {}, async (sendTransportOptions) => {
        const sendTransport = device.createSendTransport(sendTransportOptions);
        sendTransportRef.current = sendTransport;

        sendTransport.on('connect', ({ dtlsParameters }, callback) => {
          socket.emit('connectTransport', { transportType: 'send', dtlsParameters }, callback);
        });

        sendTransport.on('produce', ({ kind, rtpParameters }, callback) => {
          socket.emit('produce', { kind, rtpParameters }, ({ id }) => {
            callback({ id });
          });
        });

        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        for (const track of stream.getTracks()) {
          await sendTransport.produce({ track });
        }

        // Receive transport
        socket.emit('createRecvTransport', {}, async (recvOptions) => {
          const recvTransport = device.createRecvTransport(recvOptions);
          recvTransportRef.current = recvTransport;

          recvTransport.on('connect', ({ dtlsParameters }, callback) => {
            socket.emit('connectTransport', { transportType: 'recv', dtlsParameters }, callback);
          });

          // Consume all existing producers
          for (const producer of existingProducers) {
            consumeTrack(producer.producerId, producer.kind);
          }

          setJoinedRoom(roomIdToJoin);
        });
      });
    });
  };

  const consumeTrack = async (producerId, kind) => {
    const device = deviceRef.current;
    const recvTransport = recvTransportRef.current;
    if (!device || !recvTransport) return;

    socket.emit('consume', { producerId, rtpCapabilities: device.rtpCapabilities }, async (data) => {
      const consumer = await recvTransport.consume({
        id: data.id,
        producerId: data.producerId,
        kind: data.kind,
        rtpParameters: data.rtpParameters,
      });

      const stream = new MediaStream([consumer.track]);
      setRemoteStreams((prev) => [...prev, { id: data.producerId, stream }]);
    });
  };

  useEffect(() => {
    const handleNewProducer = ({ producerId, kind }) => {
      consumeTrack(producerId, kind);
    };

    socket.on('newProducer', handleNewProducer);
    return () => {
      socket.off('newProducer', handleNewProducer);
    };
  }, []);

  return (
    <div style={{ padding: '2rem' }}>
      <h1>Mediasoup Group Call</h1>

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

      <div style={{ marginTop: '2rem' }}>
        <h3>Local Stream</h3>
        <video
          ref={localVideoRef}
          autoPlay
          muted
          playsInline
          style={{ width: 300, margin: 10, border: '1px solid black' }}
        />
      </div>

      <div style={{ marginTop: '2rem' }}>
        <h3>Remote Participants</h3>
        {remoteStreams.map(({ id, stream }) => (
          <VideoPlayer key={id} stream={stream} />
        ))}
      </div>
    </div>
  );
}

export default App;
