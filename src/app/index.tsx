import React from "react";
import { useMutation, useQuery } from "convex/react";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { Host, Column, Row, Text, Switch, Button, OutlinedCard, CircularProgressIndicator } from "@expo/ui/jetpack-compose";
import { fillMaxSize, fillMaxWidth, paddingAll, verticalScroll } from "@expo/ui/jetpack-compose/modifiers";
import { Alert, Platform, StyleSheet, Text as RNText, View } from "react-native";
import { Pressable } from "react-native";
import { SymbolView } from "expo-symbols";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../../convex/_generated/api";
import { convexClient } from "@/lib/convex";
import { STALE_AFTER_MS } from "@/lib/types";
import type { LoadPin, LoadState } from "@/lib/types";
import { explainSpeechError, parseVoiceCommandFrom } from "@/lib/voice";
const PINS: LoadPin[] = ["V0", "V1", "V2", "V3"];
const labels: Record<LoadPin, string> = { V0: "Load 1", V1: "Load 2", V2: "Load 3", V3: "Load 4" };
/**
 * Every phrase the speech matcher accepts. This is only the recogniser's
 * context and the help card — it deliberately describes the canonical phrasing
 * while the matcher in `@/lib/voice` also accepts "load one on" and "turn on
 * load 1", so loosening the grammar can never leave the help card advertising
 * commands the parser rejects.
 */
const VOICE_COMMANDS = PINS.flatMap((_pin, index) => [
  `load ${index + 1} on`,
  `load ${index + 1} off`,
]);
function statusOf(load: LoadState, now: number, deviceLastSeen: number | null) {
  if (load.error) return { text: load.error, color: "#B3261E" };
  if (load.pending) return { text: "Sending…", color: "#687076" };
  // The firmware echoes every relay state back. Silence from the device means we
  // are only showing what we asked for rather than what the relays actually did.
  if (deviceLastSeen === null || now - deviceLastSeen > STALE_AFTER_MS) return { text: "Device not responding", color: "#B3261E" };
  if (load.confirmedAt === null) return { text: `${load.pin} | Not reported yet`, color: "#687076" };
  return { text: `${load.pin} | ${load.value ? "On" : "Off"}`, color: "#687076" };
}
function Dashboard() {
  const loads = useQuery(api.loads.list) as LoadState[] | undefined;
  const deviceLastSeen = useQuery(api.device.lastSeen) as number | null;
  // A mutation flips the switch on the next query push; the Blynk call happens
  // in a scheduled action, so the tap never waits on the network.
  const setLoad = useMutation(api.loads.request);
  const [listening, setListening] = React.useState(false);
  // What the recogniser is hearing right now, so a misheard command is visible
  // while speaking rather than only reported as a failure after the fact.
  const [heard, setHeard] = React.useState("");
  const [showHelp, setShowHelp] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());

  // Re-render periodically so "not confirmed recently" appears without a pin change.
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const toggle = React.useCallback((pin: LoadPin, value: number) => {
    void setLoad({ pin, value }).catch(() => {});
  }, [setLoad]);

  useSpeechRecognitionEvent("start", () => { setListening(true); setHeard(""); });
  useSpeechRecognitionEvent("end", () => { setListening(false); setHeard(""); });
  useSpeechRecognitionEvent("error", (event) => {
    setListening(false);
    setHeard("");
    Alert.alert("Voice command", explainSpeechError(event.error));
  });
  useSpeechRecognitionEvent("result", (event) => {
    // Interim results are shown so a misheard command is visible instead of
    // arriving as a bare "not recognised". They are never acted on.
    if (!event.isFinal) {
      setHeard(event.results[0]?.transcript ?? "");
      return;
    }
    const command = parseVoiceCommandFrom(event.results);
    if (!command) {
      const transcript = event.results[0]?.transcript.trim();
      Alert.alert("Voice command", transcript ? `Heard "${transcript}". Say: "${VOICE_COMMANDS[0]}" or "${VOICE_COMMANDS[1]}".` : `Say: "${VOICE_COMMANDS[0]}" or "${VOICE_COMMANDS[1]}".`);
      return;
    }
    toggle(command.pin, command.value);
  });

  const startListening = async () => {
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      Alert.alert("Voice command", "This device has no speech recognition service available, so commands cannot be heard.");
      return;
    }
    // Only prompt when the permission has not been granted yet; re-requesting
    // on every tap does nothing once the user has answered the system dialog.
    const current = await ExpoSpeechRecognitionModule.getPermissionsAsync();
    const permission = current.granted ? current : await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Microphone permission", "Microphone access is required for voice commands.");
      return;
    }
    ExpoSpeechRecognitionModule.start({
      lang: "en-US",
      interimResults: true,
      maxAlternatives: 3,
      contextualStrings: VOICE_COMMANDS,
    });
  };
  const insets = useSafeAreaInsets();
  return <><Host style={{ flex: 1 }} seedColor="#146C94"><Column modifiers={[fillMaxSize(), paddingAll(20), verticalScroll()]} verticalArrangement={{ spacedBy: 14 }}>
    <Text style={{ typography: "headlineMedium", fontWeight: "700" }}>Home controls</Text>
    <Text style={{ typography: "bodyMedium" }} color="#5F6368">Live device state via Blynk</Text>
    {loads ? loads.map((load) => {
      const status = statusOf(load, now, deviceLastSeen);
      return <OutlinedCard key={load.pin} modifiers={[fillMaxWidth()]}><Row modifiers={[fillMaxWidth(), paddingAll(16)]} horizontalArrangement="spaceBetween" verticalAlignment="center"><Column verticalArrangement={{ spacedBy: 3 }}><Text style={{ typography: "titleMedium", fontWeight: "600" }}>{labels[load.pin]}</Text><Text style={{ typography: "bodySmall" }} color={status.color}>{status.text}</Text></Column><Switch value={Boolean(load.value)} onCheckedChange={(value) => toggle(load.pin, value ? 1 : 0)} /></Row></OutlinedCard>;
    }) : <CircularProgressIndicator />}
    {showHelp && <OutlinedCard modifiers={[fillMaxWidth()]}><Column modifiers={[paddingAll(16)]} verticalArrangement={{ spacedBy: 6 }}><Text style={{ typography: "titleSmall", fontWeight: "600" }}>Voice commands</Text>{PINS.map((pin, index) => <Text key={pin} style={{ typography: "bodyMedium" }} color="#5F6368">“{VOICE_COMMANDS[index * 2]}” or “{VOICE_COMMANDS[index * 2 + 1]}”</Text>)}<Text style={{ typography: "bodySmall" }} color="#8A8F98">Tap the microphone, then say one of these. “Load one on” and “turn on load 1” are understood too. Nothing else is acted on.</Text></Column></OutlinedCard>}
  </Column></Host>{listening && <View pointerEvents="none" style={[styles.heard, { bottom: insets.bottom + 116 }]}><Text style={{ typography: "bodyMedium" }} color="#146C94">{heard ? `“${heard}”` : "Listening…"}</Text></View>}<Pressable accessibilityRole="button" accessibilityLabel={listening ? "Stop voice command" : "Start voice command"} onPress={() => { if (listening) ExpoSpeechRecognitionModule.stop(); else void startListening(); }} style={[styles.voiceButton, { bottom: insets.bottom + 20 }, listening && styles.voiceButtonListening]}><SymbolView name={{ android: "mic", ios: "mic.fill" }} tintColor="#FFFFFF" size={36} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel={showHelp ? "Hide voice command help" : "Show voice command help"} accessibilityState={{ expanded: showHelp }} onPress={() => setShowHelp((shown) => !shown)} style={[styles.helpButton, { bottom: insets.bottom + 34 }]}><SymbolView name={{ android: showHelp ? "close" : "help", ios: showHelp ? "xmark.circle.fill" : "questionmark.circle" }} tintColor="#146C94" size={26} /></Pressable></>;
}
export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  if (Platform.OS !== "android") return <View style={styles.fallback}><RNText>Android is required for the native control dashboard.</RNText></View>;
  if (!convexClient) return <View style={styles.fallback}><RNText>Configure EXPO_PUBLIC_CONVEX_URL to connect this dashboard.</RNText></View>;
  return <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}><Dashboard /></View>;
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  fallback: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  voiceButton: { position: "absolute", alignSelf: "center", left: "50%", marginLeft: -40, width: 80, height: 80, borderRadius: 40, backgroundColor: "#146C94", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 10px rgba(0, 0, 0, 0.22)" },
  voiceButtonListening: { backgroundColor: "#B3261E" },
  heard: { position: "absolute", alignSelf: "center", backgroundColor: "#FFFFFF", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: "#D6DEE5", maxWidth: "80%", shadowColor: "#000000", shadowOpacity: 0.18, shadowRadius: 6, elevation: 3 },
  helpButton: { position: "absolute", right: 20, width: 48, height: 48, borderRadius: 24, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#D6DEE5", boxShadow: "0 2px 6px rgba(0, 0, 0, 0.18)" },
});