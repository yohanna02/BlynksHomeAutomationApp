import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";

const pinValidator = v.union(
  v.literal("V0"),
  v.literal("V1"),
  v.literal("V2"),
  v.literal("V3"),
);

const BLYNK_BASE_URL = "https://blynk.cloud";

// The ESP-01 forwards a write to the Arduino over serial, the Arduino drives the
// relay and echoes the resulting states back, and the ESP-01 pushes them to Blynk.
// This delay lets that round trip finish before we ask Blynk what the pin holds.
const CONFIRM_DELAY_MS = 1200;

function authToken() {
  const token = process.env.BLYNK_AUTH_TOKEN;
  if (!token) throw new Error("BLYNK_AUTH_TOKEN is not configured");
  return token;
}

/** Blynk reports failures as HTTP 400 with `{"error":{"message":"..."}}`. */
async function describeFailure(response: Response): Promise<string> {
  const body = (await response.text()).trim();
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // Not JSON; fall through to the raw body.
  }
  return body || `Blynk request failed (${response.status})`;
}

async function updatePin(token: string, pin: string, value: number) {
  const response = await fetch(
    `${BLYNK_BASE_URL}/external/api/update?token=${encodeURIComponent(token)}&${pin}=${value}`,
  );
  if (!response.ok) throw new Error(await describeFailure(response));
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Blynk documents no 200 body for a single-pin `get`, so accept every shape the
 * endpoint has been seen returning: `{"v0":1}`, a bare `1`, or `"1"`. Returns
 * null rather than guessing when nothing numeric comes back.
 */
async function readPin(token: string, pin: string): Promise<number | null> {
  const response = await fetch(
    `${BLYNK_BASE_URL}/external/api/get?token=${encodeURIComponent(token)}&${pin.toLowerCase()}`,
  );
  if (!response.ok) throw new Error(await describeFailure(response));

  const body = (await response.text()).trim();
  if (!body) return null;

  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      for (const key of [pin.toLowerCase(), pin.toUpperCase()]) {
        const value = toNumber(record[key]);
        if (value !== null) return value;
      }
      return toNumber(Object.values(record)[0]);
    }
    return toNumber(parsed);
  } catch {
    return toNumber(body);
  }
}

/**
 * Sends a load value to Blynk, then reads the pin back. The read-back matters
 * because this firmware round trips the write through the relay: if the Arduino
 * is unplugged or refuses the command, the pin comes back holding the old value
 * and the switch reverts instead of silently lying.
 */
export const applyLoad = internalAction({
  args: { pin: pinValidator, value: v.number(), seq: v.number() },
  handler: async (ctx, args) => {
    try {
      const token = authToken();
      await updatePin(token, args.pin, args.value);
      await new Promise((resolve) => setTimeout(resolve, CONFIRM_DELAY_MS));

      const actual = await readPin(token, args.pin);
      await ctx.runMutation(internal.loads.confirm, {
        pin: args.pin,
        // If the read-back came back unreadable, trust the write and let a later
        // webhook correct us rather than reverting a change that likely worked.
        value: actual ?? args.value,
        seq: args.seq,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`Blynk write for ${args.pin} failed:`, message);
      await ctx.runMutation(internal.loads.fail, { pin: args.pin, message, seq: args.seq });
    }
  },
});