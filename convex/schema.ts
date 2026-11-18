import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const pinValidator = v.union(
  v.literal("V0"),
  v.literal("V1"),
  v.literal("V2"),
  v.literal("V3"),
);

export default defineSchema({
  loads: defineTable({
    pin: pinValidator,
    // Latest known device state. Written optimistically when a switch is tapped,
    // then corrected by the ESP-01's echo (via webhook) or a read-back from Blynk.
    value: v.number(),
    // Last value a device confirmed, so a failed write can revert to it. Optional
    // so rows written before this field existed still read back correctly.
    confirmedValue: v.optional(v.number()),
    // True between a tap and its confirmation.
    pending: v.optional(v.boolean()),
    // Incremented on every write so a late confirmation from a superseded tap is
    // discarded instead of resurrecting a stale value.
    seq: v.optional(v.number()),
    // Last failure message, cleared on the next successful confirmation.
    error: v.optional(v.string()),
    // When a device last reported this pin. A pin that silently stops echoing
    // back (Arduino unplugged, ESP-01 offline) grows stale here.
    confirmedAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_pin", ["pin"]),

  // One row tracking whether the device is still reachable. The ESP-01 bumps a
  // heartbeat datastream on a timer precisely so this stays fresh while the
  // loads sit idle - a pin-change webhook alone cannot tell us that.
  device: defineTable({
    lastSeen: v.number(),
  }),
});