import { io, Socket } from 'socket.io-client';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(`${API_BASE}/runs`, {
      transports: ['websocket'],
      auth: {
        // In cookie-based auth, the server reads from handshake.auth.token
        // For WebSocket, we pass the token from the cookie if accessible
        // The RunGateway handles auth manually in handleConnection()
      },
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
