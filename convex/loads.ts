import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";

const pinValidator = v.union(
  v.literal("V0"),
  v.literal("V1"),
  v.literal("V2"),
  v.literal("V3"),
);

const PINS = ["V0", "V1", "V2", "V3"] as const;

type Pin = (typeof PINS)[number];

function getByPin(ctx: QueryCtx, pin: Pin) {
  return ctx.db.query("loads").withIndex("by_pin", (q) => q.eq("pin", pin)).unique();
}

/** Inserts or patches the row for `pin`, so pins work before any row exists. */
async function write(
  ctx: MutationCtx,
  pin: Pin,
  fields: Partial<{
    value: number;
    confirmedValue: number;
    pending: boolean;
    seq: number;
    error: string;
    confirmedAt: number;
    updatedAt: number;
  }>,
) {
  const now = Date.now();
  const existing = await getByPin(ctx, pin);
  const data = { ...fields, updatedAt: now };
  if (existing) {
    await ctx.db.patch("loads", existing._id, data);
  } else {
    await ctx.db.insert("loads", { pin, value: 0, confirmedValue: 0, ...data });
  }
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("loads").take(PINS.length * 4);
    return PINS.map((pin) => {
      const row = rows.find((r) => r.pin === pin);
      return {
        pin,
        value: row?.value ?? 0,
        pending: row?.pending ?? false,
        error: row?.error ?? null,
        updatedAt: row?.updatedAt ?? 0,
        confirmedAt: row?.confirmedAt ?? null,
      };
    });
  },
});

/**
 * Called when a switch is tapped or a voice command matches. Flips the switch
 * immediately by writing the desired value, then hands the actual Blynk call to
 * an action so the write never blocks on the network round trip.
 */
export const request = mutation({
  args: { pin: pinValidator, value: v.number() },
  handler: async (ctx, args) => {
    const existing = await getByPin(ctx, args.pin);
    const seq = (existing?.seq ?? 0) + 1;
    await write(ctx, args.pin, {
      value: args.value,
      // Seed the revert target for rows written before this field existed.
      confirmedValue: existing?.confirmedValue ?? existing?.value,
      pending: true,
      error: undefined,
      seq,
    });
    await ctx.scheduler.runAfter(0, internal.blynk.applyLoad, {
      pin: args.pin,
      value: args.value,
      seq,
    });
    return null;
  },
});

/** A read-back matched the value we asked for. */
export const confirm = internalMutation({
  args: { pin: pinValidator, value: v.number(), seq: v.number() },
  handler: async (ctx, args) => {
    const existing = await getByPin(ctx, args.pin);
    // A newer tap superseded this write, so its result is stale.
    if (!existing || existing.seq !== args.seq) return;
    await write(ctx, args.pin, {
      value: args.value,
      confirmedValue: args.value,
      pending: false,
      error: undefined,
      confirmedAt: Date.now(),
    });
  },
});

/** The write never landed. Revert the switch and surface why. */
export const fail = internalMutation({
  args: { pin: pinValidator, message: v.string(), seq: v.number() },
  handler: async (ctx, args) => {
    const existing = await getByPin(ctx, args.pin);
    if (!existing || existing.seq !== args.seq) return;
    await write(ctx, args.pin, {
      value: existing.confirmedValue ?? existing.value,
      pending: false,
      error: args.message,
    });
  },
});

/**
 * An observed value from the ESP-01. Authoritative: it arrives only after the
 * write has been pushed to the Arduino and the resulting relay state echoed back,
 * so it beats anything we inferred locally.
 */
export const setFromWebhook = internalMutation({
  args: { pin: pinValidator, value: v.number() },
  handler: async (ctx, args) => {
    const existing = await getByPin(ctx, args.pin);
    const agrees = existing !== null && args.value === existing.value;

    // While a write is in flight, a contradicting value is the echo of our own
    // write arriving before the device has settled — not news about the relay.
    // Acting on it yanks the switch back under the user's thumb. The read-back
    // scheduled ~1.2s later resolves the real state either way, so dropping it
    // here costs nothing and stops the bounce.
    if (existing?.pending && !agrees) return;

    await write(ctx, args.pin, {
      value: args.value,
      confirmedValue: args.value,
      pending: false,
      error: undefined,
      confirmedAt: Date.now(),
      // Only cancel an in-flight write when we're actually overriding it; if the
      // device agreed, let its confirmation land normally.
      seq: agrees ? existing.seq : (existing?.seq ?? 0) + 1,
    });
  },
});