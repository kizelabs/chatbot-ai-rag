import { consumePendingControlEvents, sqlWorker } from "@chatbot/db";
import pino from "pino";

export type ControlKind = "pair" | "unpair" | "reload_config" | "ingest_document";

const logger = pino({ name: "control-events" });

export const startControlEventLoop = async (
  onEvent: (kind: ControlKind, payload: unknown) => Promise<void>
): Promise<() => void> => {
  let closed = false;

  const consume = async (): Promise<void> => {
    const pending = await consumePendingControlEvents(50);
    for (const event of pending) {
      if (
        event.kind === "pair" ||
        event.kind === "unpair" ||
        event.kind === "reload_config" ||
        event.kind === "ingest_document"
      ) {
        await onEvent(event.kind, event.payload);
      } else {
        logger.warn({ kind: event.kind }, "Skipping unknown control event");
      }
    }
  };

  await consume();

  const interval = setInterval(() => {
    void consume().catch((error) => {
      logger.error({ error }, "Control-event poll fallback failed");
    });
  }, 5000);

  await sqlWorker.listen("control_events", async () => {
    await consume();
  });

  return () => {
    if (closed) {
      return;
    }
    closed = true;
    clearInterval(interval);
  };
};
