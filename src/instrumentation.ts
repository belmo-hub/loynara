/** Do not inspect error, request or context: these can include private card URLs and credentials. */
export async function onRequestError() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { recordOperationalEvent, flushOperationalEvents } = await import("./lib/operational-signals");
    recordOperationalEvent("request_error");
    await flushOperationalEvents();
  }
}
