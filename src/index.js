import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import {
  MAX_PLAYERS_PER_ROOM,
  normalizeRoomCode
} from "./rooms.js";

const PORT = process.env.PORT || 10000;
const HOST = "0.0.0.0";

const httpServer = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("RoomBase Server is running!");
});

const wss = new WebSocketServer({ server: httpServer });

const clients = new Map();
const rooms = new Map();

function send(socket, data) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  }
}

function broadcastRoom(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const players = [...room.players].map(id => {
    const client = clients.get(id);
    return {
      id,
      username: client?.username || "Player"
    };
  });

  for (const id of room.players) {
    const client = clients.get(id);
    if (client) {
      send(client.socket, {
        type: "players",
        players
      });
    }
  }
}

function createRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;

  do {
    code = Array.from(
      { length: 6 },
      () => chars[Math.floor(Math.random() * chars.length)]
    ).join("");
  } while (rooms.has(code));

  return code;
}

function leaveRoom(client) {
  if (!client.roomCode) return;

  const oldRoomCode = client.roomCode;
  const room = rooms.get(oldRoomCode);

  if (room) {
    room.players.delete(client.id);
    room.playerData.delete(client.id);

    if (room.players.size === 0) {
      rooms.delete(oldRoomCode);
    } else {
      broadcastRoom(oldRoomCode);
    }
  }

  client.roomCode = null;
}

wss.on("connection", socket => {
  const id = randomUUID();

  const client = {
    id,
    socket,
    username: "Player",
    roomCode: null
  };

  clients.set(id, client);
  send(socket, { type: "connected", playerId: id });

  socket.on("message", raw => {
    let data;

    try {
      data = JSON.parse(raw.toString());
    } catch {
      return send(socket, {
        type: "error",
        message: "Invalid JSON"
      });
    }

    switch (data.type) {
      case "set_username": {
        if (typeof data.username !== "string") break;

        client.username = data.username.trim().slice(0, 24) || "Player";

        if (client.roomCode) broadcastRoom(client.roomCode);
        break;
      }

      case "create_room": {
        leaveRoom(client);

        const code = createRoomCode();

        rooms.set(code, {
          players: new Set([id]),
          playerData: new Map()
        });

        client.roomCode = code;

        send(socket, {
          type: "room_created",
          roomCode: code
        });

        broadcastRoom(code);
        break;
      }

      case "join_room": {
        const code = normalizeRoomCode(data.roomCode);
        const room = rooms.get(code);

        if (!room) {
          return send(socket, {
            type: "error",
            message: "Room not found"
          });
        }

        if (room.players.size >= MAX_PLAYERS_PER_ROOM) {
          return send(socket, {
            type: "error",
            message: "Room is full"
          });
        }

        leaveRoom(client);

        room.players.add(id);
        client.roomCode = code;

        send(socket, {
          type: "room_joined",
          roomCode: code
        });

        broadcastRoom(code);
        break;
      }

      case "leave_room": {
        leaveRoom(client);
        send(socket, { type: "room_left" });
        break;
      }

      case "message": {
        if (!client.roomCode) break;
        if (typeof data.message !== "string") break;
        if (data.message.length > 2000) break;

        const room = rooms.get(client.roomCode);
        if (!room) break;

        for (const playerId of room.players) {
          if (playerId === id) continue;

          const recipient = clients.get(playerId);

          if (recipient) {
            send(recipient.socket, {
              type: "message",
              sender: id,
              message: data.message
            });
          }
        }
        break;
      }

      // ROOMBASE SPACE
      case "space_position": {
        if (!client.roomCode) break;

        const room = rooms.get(client.roomCode);
        if (!room) break;

        const x = Number(data.x);
        const y = Number(data.y);

        if (!Number.isFinite(x) || !Number.isFinite(y)) break;

        // Save latest player position
        room.playerData.set(id, { x, y });

        // Send position to other players
        for (const playerId of room.players) {
          if (playerId === id) continue;

          const recipient = clients.get(playerId);

          if (recipient) {
            send(recipient.socket, {
              type: "space_position",
              playerId: id,
              x,
              y
            });
          }
        }
        break;
      }
    }
  });

  socket.on("close", () => {
    leaveRoom(client);
    clients.delete(id);
  });

  socket.on("error", () => {
    leaveRoom(client);
    clients.delete(id);
  });
});

httpServer.listen(PORT, HOST, () => {
  console.log(`RoomBase Server listening on ${HOST}:${PORT}`);
});
