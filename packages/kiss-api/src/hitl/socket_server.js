import { Server as SocketIOServer } from "socket.io";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { hitlBus } from "./hitl_bus.js";
import { recordHitlResponse } from "./hitl_service.js";

/**
 * Attach Socket.io to an existing HTTP server.
 *
 * Rooms:
 * - branch:${BRANCH_ID}
 *
 * Events:
 * - server -> client: hitl_request (instruction payload)
 * - client -> server: hitl_response ({instruction_id, decision, comment})
 */
export function attachHitlSocket(httpServer) {
  if (!config.hitl.enabled) {
    logger.warn("HITL is disabled. Socket.io not attached.");
    return null;
  }

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: config.hitl.allowedOrigins.length ? config.hitl.allowedOrigins : true,
      credentials: true,
    },
    pingInterval: 25000,
    pingTimeout: 60000,
    transports: ["websocket", "polling"],
  });

  io.use((socket, next) => {
    try {
      const auth = socket.handshake.auth || {};
      const token = auth.token;
      const branch_id = String(auth.branch_id || "").toUpperCase();
      if (!token || !branch_id) return next(new Error("MISSING_AUTH"));

      const expected = config.hitl.branchTokens?.[branch_id];
      if (!expected || expected !== token) return next(new Error("INVALID_TOKEN"));

      socket.data.branch_id = branch_id;
      socket.data.role = auth.role || "GERENTE_SUCURSAL";
      socket.data.device_id = auth.device_id || socket.id;
      socket.data.user_id = auth.user_id || null;
      socket.data.name = auth.name || "staff_tablet";

      return next();
    } catch (e) {
      return next(new Error("AUTH_ERROR"));
    }
  });

  io.on("connection", (socket) => {
    const branch_id = socket.data.branch_id;
    socket.join(`branch:${branch_id}`);

    logger.info(
      { socket_id: socket.id, branch_id, role: socket.data.role },
      "HITL staff connected"
    );

    socket.on("hitl_response", async (payload, ack) => {
      try {
        const instruction_id = payload?.instruction_id;
        const decision = String(payload?.decision || "").toUpperCase();
        const comment = String(payload?.comment || "");

        if (!instruction_id || !decision) throw new Error("BAD_PAYLOAD");

        const result = await recordHitlResponse({
          instruction_id,
          branch_id,
          actor: {
            role: socket.data.role,
            name: socket.data.name,
            user_id: socket.data.user_id,
            device_id: socket.data.device_id,
          },
          decision,
          comment,
        });

        if (typeof ack === "function") ack({ ok: true, ...result });

        // notify the tablet UI
        socket.emit("hitl_ack", { ok: true, instruction_id });
      } catch (e) {
        logger.error({ err: e?.message || String(e) }, "hitl_response failed");
        if (typeof ack === "function") ack({ ok: false, error: e?.message || String(e) });
      }
    });

    socket.on("disconnect", (reason) => {
      logger.info({ socket_id: socket.id, branch_id, reason }, "HITL staff disconnected");
    });
  });

  // When a request is created, push it to the right room.
  hitlBus.on("hitl_request", ({ branch_id, instruction }) => {
    const room = `branch:${String(branch_id).toUpperCase()}`;
    io.to(room).emit("hitl_request", instruction);
  });

  return io;
}
