import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * The ESP-01 writes a counter to a spare datastream on a timer. Because that
 * value always changes, Blynk always fires the pin-change webhook, so this is
 * the one signal that reaches the app while the house is sitting idle and every
 * load is unchanged.
 */
export const noteHeartbeat = internalMutation({
  args: { at: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("device").take(1);
    if (existing.length > 0) {
      await ctx.db.patch("device", existing[0]._id, { lastSeen: args.at });
    } else {
      await ctx.db.insert("device", { lastSeen: args.at });
    }
  },
});

export const lastSeen = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("device").take(1);
    return rows[0]?.lastSeen ?? null;
  },
});