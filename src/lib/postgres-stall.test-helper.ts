import { createServer, type Socket } from "node:net";

/** A private protocol blackhole, not a database: it never executes SQL. */
export async function startStalledPostgres(acceptStartup: boolean) {
  let queries = 0;
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => undefined);
    socket.on("close", () => sockets.delete(socket));
    let started = false;
    socket.on("data", (bytes) => {
      if (!acceptStartup) return;
      if (!started) {
        started = true;
        // PostgreSQL wire AuthenticationOk + ReadyForQuery. Subsequent
        // queries intentionally receive no response, including timeout setup.
        socket.write(Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0, 0x5a, 0, 0, 0, 5, 0x49]));
      } else if ((bytes[0] === 0x51 || bytes[0] === 0x50)) queries++;
    });
  });
  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Synthetic listener did not bind");
  return {
    url: `postgresql://synthetic:synthetic@127.0.0.1:${address.port}/synthetic?sslmode=disable`,
    queryCount: () => queries,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      await new Promise<void>((resolve) => { server.close(() => resolve()); });
    },
  };
}
