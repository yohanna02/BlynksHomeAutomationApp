import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { httpRouter } from "convex/server";

const http = httpRouter();

/**
 * Blynk pin-change webhook. Blynk fills the placeholders in the configured
 * custom JSON, so `{device_pinValue}` arrives as a string and `{device_pin}` as
 * something like "V0" — normalise both before validating.
 */
http.route({
  path: "/blynk/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.BLYNK_WEBHOOK_SECRET;
    if (secret && request.headers.get("x-webhook-secret") !== secret) {
      return new Response("Unauthorized", { status: 401 });
    }

    const body: unknown = await request.json().catch(() => null);
    const fields =
      typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

    const rawPin = fields.pin;
    const rawValue = fields.value;
    const pin = typeof rawPin === "string" ? rawPin.trim().toUpperCase() : null;

    if (!pin) return new Response("Invalid payload", { status: 400 });

    // The heartbeat datastream carries a counter, not a load state. It exists so
    // the app can tell a live device from a silent one.
    const heartbeatPin = (process.env.BLYNK_HEARTBEAT_PIN ?? "V4").toUpperCase();
    if (pin === heartbeatPin) {
      await ctx.runMutation(internal.device.noteHeartbeat, { at: Date.now() });
      return Response.json({ ok: true });
    }

    const value = typeof rawValue === "number" ? rawValue : Number(rawValue);
    if (!/^V[0-3]$/.test(pin) || !Number.isFinite(value)) {
      console.log("Blynk webhook rejected:", body);
      return new Response("Invalid payload", { status: 400 });
    }

    await ctx.runMutation(internal.loads.setFromWebhook, {
      pin: pin as "V0" | "V1" | "V2" | "V3",
      value,
    });
    return Response.json({ ok: true });
  }),
});

export default http;