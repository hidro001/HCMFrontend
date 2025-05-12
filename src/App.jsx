// App.jsx
import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import * as mediasoupClient from 'mediasoup-client';

const socket = io('http://localhost:3000', { transports: ['websocket'] });

// A little component that attaches a MediaStream to a <video>
function VideoPlayer({ stream }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && stream) {
      console.log('⏩ Attaching remote stream', stream.id);
      ref.current.srcObject = stream;
    }
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      style={{ width: 300, margin: 10, border: '1px solid #ccc' }}
    />
  );
}

export default function App() {
  const localRef = useRef(null);
  const [device, setDevice] = useState(null);
  const [recvTransport, setRecvTransport] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState([]);
  const roomId = 'test-room';

  useEffect(() => {
    let mounted = true;

    (async () => {
      // 1) Join the room, get router RTP caps + existing producers
      const [caps, existing] = await new Promise((res) =>
        socket.emit('joinRoom', { roomId }, (c, e) => res([c, e]))
      );
      console.log('🔗 joined, caps=', caps, 'existing=', existing);

      // 2) Load the Mediasoup Device
      const dev = new mediasoupClient.Device();
      await dev.load({ routerRtpCapabilities: caps });
      if (!mounted) return;
      setDevice(dev);

      // 3) Create & publish via sendTransport
      await createSendTransport(dev);

      // 4) Create recvTransport
      const recv = await createRecvTransport(dev);
      if (!mounted) return;
      setRecvTransport(recv);

      // 5) Consume all existing video producers
      for (const { producerId, kind, socketId } of existing) {
        if (kind === 'video') {
          console.log('▶️ consume existing', producerId);
          await consumeVideo(producerId, socketId, dev, recv);
        }
      }

      // 6) Listen for new producers
      socket.on('newProducer', ({ producerId, kind, socketId }) => {
        if (kind === 'video') {
          console.log('🔔 newProducer', producerId);
          consumeVideo(producerId, socketId, dev, recv);
        }
      });
    })();

    return () => {
      mounted = false;
      socket.emit('leaveRoom');
      socket.off('newProducer');
    };
  }, []);

  // -- Helper to create sendTransport and publish local camera
  function createSendTransport(dev) {
    return new Promise((resolve) => {
      socket.emit('createSendTransport', {}, async (params) => {
        console.log('📤 sendTransport params', params);
        const tr = dev.createSendTransport(params);
        tr.on('connect', ({ dtlsParameters }, cb) => {
          console.log('sendTransport connect');
          socket.emit('connectTransport', { transportType: 'send', dtlsParameters }, cb);
        });
        tr.on('produce', ({ kind, rtpParameters }, cb) => {
          console.log('sendTransport produce', kind);
          socket.emit('produce', { kind, rtpParameters }, ({ id }) => cb({ id }));
        });

        // publish local stream
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        console.log('🎥 got local stream', stream.id);
        if (localRef.current) localRef.current.srcObject = stream;
        for (const track of stream.getTracks()) {
          await tr.produce({ track });
        }
        resolve(tr);
      });
    });
  }

  // -- Helper to create recvTransport
  function createRecvTransport(dev) {
    return new Promise((resolve) => {
      socket.emit('createRecvTransport', {}, (params) => {
        console.log('📥 recvTransport params', params);
        const tr = dev.createRecvTransport(params);
        tr.on('connect', ({ dtlsParameters }, cb) => {
          console.log('recvTransport connect');
          socket.emit('connectTransport', { transportType: 'recv', dtlsParameters }, cb);
        });
        resolve(tr);
      });
    });
  }

  // -- Helper to consume a single video producer
  async function consumeVideo(producerId, socketId, dev, transport) {
    console.log('➡️ requesting consume for', producerId);
    socket.emit(
      'consume',
      { producerId, rtpCapabilities: dev.rtpCapabilities },
      async (params) => {
        console.log('⬅️ consume callback params', params);
        try {
          const consumer = await transport.consume({
            id: params.id,
            producerId: params.producerId,
            kind: 'video',
            rtpParameters: params.rtpParameters,
          });
          console.log('✅ consumer created', consumer.id);

          // resume the consumer to start RTP
          await consumer.resume();
          console.log('▶️ consumer resumed');

          const stream = new MediaStream([consumer.track]);
          setRemoteStreams((all) => {
            // either add to existing or push new
            const idx = all.findIndex((s) => s.socketId === socketId);
            if (idx >= 0) {
              all[idx].stream.addTrack(consumer.track);
              return [...all];
            }
            return [...all, { socketId, stream }];
          });
        } catch (err) {
          console.error('❌ transport.consume failed', err);
        }
      }
    );
  }

  return (
    <div style={{ padding: '1rem' }}>
      <h1>SFU Video Call</h1>
      <section>
        <h2>Local Stream</h2>
        <video
          ref={localRef}
          autoPlay
          muted
          playsInline
          style={{ width: 300, border: '1px solid #ccc' }}
        />
      </section>
      <section>
        <h2>Remote Streams</h2>
        {remoteStreams.length === 0 ? (
          <p>No remote video yet.</p>
        ) : (
          remoteStreams.map(({ socketId, stream }) => (
            <VideoPlayer key={socketId} stream={stream} />
          ))
        )}
      </section>
    </div>
  );
}
