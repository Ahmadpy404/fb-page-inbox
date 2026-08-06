import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';

let io: Server | null = null;

export function initSocket(server: HttpServer): Server {
  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    },
  });

  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    socket.on('disconnect', () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);
    });
  });

  return io;
}

export function getIO(): Server | null {
  return io;
}

export function emitNewMessage(payload: { message: any; conversation: any }): void {
  if (io) {
    io.emit('new_message', payload);
  }
}

export function emitNewReply(payload: { message: any; conversationId: string }): void {
  if (io) {
    io.emit('new_reply', payload);
  }
}

export function emitConversationUpdated(conversation: any): void {
  if (io) {
    io.emit('conversation_updated', conversation);
  }
}

export function emitSyncStatus(status: { inProgress: boolean; total?: number; synced?: number; message?: string }): void {
  if (io) {
    io.emit('sync_status', status);
  }
}

export function emitMessageRead(payload: { conversationId: string; watermark: number; readAt: string }): void {
  if (io) {
    io.emit('message_read', payload);
  }
}

export function emitTypingStatus(payload: { conversationId: string; isTyping: boolean }): void {
  if (io) {
    io.emit('typing_status', payload);
  }
}

