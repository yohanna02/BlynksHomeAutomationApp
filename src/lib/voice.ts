import type { LoadPin } from "./types";

/** A relay action recovered from what the recogniser heard. */
export type VoiceCommand = { pin: LoadPin; value: 0 | 1 };

/**
 * How the recogniser is asked to spell the load number. Google's recogniser
 * returns digits for some speakers and words for others, and picks whichever
 * fits the surrounding prosody — "load 1 on" and "load one on" are the same
 * request. The bare digits and the homophones are both in the set because the
 * failures people actually hit are "load one on" (number word) and "load 2 to"
 * (load two), not exotic spellings.
 */
const NUMBER_WORDS: Record<string, number> = {
  one: 1, won: 1, "1": 1,
  two: 2, to: 2, too: 2, "2": 2,
  three: 3, tree: 3, "3": 3,
  four: 4, for: 4, "4": 4,
  five: 5, "5": 5,
  six: 6, "6": 6,
};

/**
 * Load state. "of" is here because "load 1 of" is the most common single
 * mishearing of "load 1 off" — the trailing consonant pair is easy to lose.
 */
const STATE_WORDS: Record<string, 0 | 1> = {
  on: 1, "1": 1,
  off: 0, of: 0,
};

/** Punctuation becomes a separator so "load 1 on." tokenises like "load 1 on". */
function tokenize(transcript: string): string[] {
  return transcript
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Recovers a single relay command from one transcript, or null if it is not
 * one. Deliberately order-independent: "load 1 on", "turn on load 1", and "on
 * load one" all mean the same thing, and insisting on one phrasing is what
 * made the previous exact-match grammar miss most of what people actually said.
 *
 * An utterance naming more than one load or more than one state is rejected
 * rather than guessed at. Picking the first of two would silently act on half
 * of what someone said, which for a command that switches mains is worse than
 * saying nothing.
 */
export function parseVoiceCommand(transcript: string): VoiceCommand | null {
  const tokens = tokenize(transcript);

  const numbers = new Set<number>();
  const states = new Set<0 | 1>();
  for (const token of tokens) {
    const number = NUMBER_WORDS[token];
    // "1"/"2" are ambiguous between the two tables; the number reading wins and
    // the state is picked up separately, so "load 1" alone stays a miss.
    if (number !== undefined) numbers.add(number);
    const state = STATE_WORDS[token];
    if (state !== undefined && NUMBER_WORDS[token] === undefined) states.add(state);
  }

  const loads = [...numbers].filter((n) => n >= 1 && n <= 4);
  if (loads.length !== 1 || states.size !== 1) return null;

  return { pin: (`V${loads[0] - 1}`) as LoadPin, value: [...states][0] };
}

/**
 * Walks the recogniser's ranked alternatives and returns the first one that
 * parses. The recogniser was asked for several transcriptions and ranked them
 * by confidence; taking only the top one throws that ranking away, and for a
 * short fixed grammar the correct phrasing regularly lands in second place.
 */
export function parseVoiceCommandFrom(
  results: readonly { transcript: string }[] | undefined,
): VoiceCommand | null {
  for (const result of results ?? []) {
    const command = parseVoiceCommand(result.transcript);
    if (command) return command;
  }
  return null;
}

/**
 * What to tell the user when recognition itself failed. The raw platform
 * message is written for developers and several of these codes have a specific
 * user-side fix, so they are translated rather than shown raw.
 */
export function explainSpeechError(error: string): string {
  switch (error) {
    case "not-allowed":
      return "Microphone access was denied. Enable it for this app in Android Settings → Apps → Permissions.";
    case "service-not-allowed":
      return "This device has no speech recognition service available, so commands cannot be heard.";
    case "network":
      return "Recognition needs a network connection and could not reach it. The voice model for English may not be downloaded yet.";
    case "no-speech":
      return "Nothing was heard. Tap the microphone and speak as soon as it turns red.";
    case "speech-timeout":
      return "The microphone stopped listening before a command finished. Try again and speak without pausing.";
    case "busy":
      return "The recogniser is already busy. Wait a moment and tap again.";
    case "audio-capture":
      return "The microphone could not be opened. Another app may be using it.";
    case "language-not-supported":
      return "English recognition is not available on this device.";
    default:
      return "Voice recognition failed unexpectedly. Try again.";
  }
}