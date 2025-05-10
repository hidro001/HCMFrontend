import React, { useState, useRef, useEffect } from 'react';
import { io } from 'socket.io-client';
import { Device } from 'mediasoup-client';

const socket = io('wss://demov2.humanmaximizer.com', {
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
    joinRoom(newRoomId);
  };

  const handleJoinRoom = () => {
    if (!inputRoomId.trim()) return;
    setRoomId(inputRoomId.trim());
    joinRoom(inputRoomId.trim());
  };

  const joinRoom = async (roomIdToJoin) => {
    socket.emit(
      'joinRoom',
      { roomId: roomIdToJoin },
      async (routerRtpCapabilities, existingProducers) => {
        const device = new Device();
        await device.load({ routerRtpCapabilities });
        deviceRef.current = device;

        // --- Create Send Transport ---
        socket.emit('createSendTransport', {}, async (sendOpts) => {
          const sendTransport = device.createSendTransport(sendOpts);
          sendTransportRef.current = sendTransport;

          sendTransport.on('connect', ({ dtlsParameters }, cb) => {
            socket.emit('connectTransport', { transportType: 'send', dtlsParameters }, cb);
          });

          sendTransport.on('produce', ({ kind, rtpParameters }, cb) => {
            socket.emit('produce', { kind, rtpParameters }, ({ id }) => {
              cb({ id });
            });
          });

          // Grab local media
          const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
          });
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = stream;
          }

          // Produce each track
          for (const track of stream.getTracks()) {
            await sendTransport.produce({ track });
          }

          // --- Create Recv Transport ---
          socket.emit('createRecvTransport', {}, async (recvOpts) => {
            const recvTransport = device.createRecvTransport(recvOpts);
            recvTransportRef.current = recvTransport;

            recvTransport.on('connect', ({ dtlsParameters }, cb) => {
              socket.emit(
                'connectTransport',
                { transportType: 'recv', dtlsParameters },
                cb
              );
            });

            // Consume any existing producers
            for (const p of existingProducers) {
              consumeTrack(p.producerId, p.kind);
            }

            setJoinedRoom(roomIdToJoin);
          });
        });
      }
    );
  };

  const consumeTrack = async (producerId, kind) => {
    const device = deviceRef.current;
    const recvTransport = recvTransportRef.current;
    if (!device || !recvTransport) return;

    socket.emit(
      'consume',
      { producerId, rtpCapabilities: device.rtpCapabilities },
      async (data) => {
        const consumer = await recvTransport.consume({
          id: data.id,
          producerId: data.producerId,
          kind: data.kind,
          rtpParameters: data.rtpParameters,
        });

        const stream = new MediaStream([consumer.track]);
        setRemoteStreams((prev) => [...prev, { id: data.producerId, stream }]);
      }
    );
  };

  useEffect(() => {
    const onNewProducer = ({ producerId, kind }) => {
      consumeTrack(producerId, kind);
    };
    socket.on('newProducer', onNewProducer);
    return () => {
      socket.off('newProducer', onNewProducer);
    };
  }, []);

  // --- New End Call handler ---
  const handleEndCall = () => {
    // 1. Close Mediasoup transports
    if (sendTransportRef.current) {
      sendTransportRef.current.close();
      sendTransportRef.current = null;
    }
    if (recvTransportRef.current) {
      recvTransportRef.current.close();
      recvTransportRef.current = null;
    }

    // 2. Stop local media
    if (localVideoRef.current?.srcObject) {
      localVideoRef.current.srcObject.getTracks().forEach((t) => t.stop());
      localVideoRef.current.srcObject = null;
    }

    // 3. Disconnect socket
    socket.off();
    socket.disconnect();

    // 4. Reset state
    setJoinedRoom(null);
    setRoomId('');
    setInputRoomId('');
    setRemoteStreams([]);
  };

  return (
    <div style={{ padding: '2rem' }}>
      <h1>Mediasoup Group Call</h1>

      {/* End Call */}
      {joinedRoom && (
        <button
          onClick={handleEndCall}
          style={{
            background: '#e53e3e',
            color: 'white',
            border: 'none',
            padding: '0.5rem 1rem',
            borderRadius: '0.25rem',
            cursor: 'pointer',
            marginBottom: '1rem',
          }}
        >
          End Call
        </button>
      )}

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
