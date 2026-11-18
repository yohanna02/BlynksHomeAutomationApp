export type LoadPin = "V0" | "V1" | "V2" | "V3";

export type LoadState = {
  pin: LoadPin;
  /** Latest known state — optimistic while a write is in flight. */
  value: number;
  pending: boolean;
  /** Why the last write failed, if it did. */
  error: string | null;
  updatedAt: number;
  /** When a device last reported this pin. */
  confirmedAt: number | null;
};

/**
 * How long the device may go silent before the dashboard says so. The firmware
 * heartbeats every 30s, so this tolerates a couple of missed beats.
 */
export const STALE_AFTER_MS = 75_000;