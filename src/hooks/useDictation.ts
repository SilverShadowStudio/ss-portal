import { useCallback, useEffect, useRef, useState } from "react";

// Browser speech-to-text, shared by the Director's composer and the call
// debrief. Free, no key, no per-minute cost — good in Chrome and Edge, patchy
// in Safari, weakest on iOS. `supported` is false where the API is absent, so a
// caller can hide the button rather than offer one that fails.

interface SRAlternative { transcript: string }
interface SRResult { isFinal: boolean; 0: SRAlternative; length: number }
interface SREvent { resultIndex: number; results: { length: number; [i: number]: SRResult } }
interface SRErrorEvent { error: string }
interface SRInstance {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type SRCtor = new () => SRInstance;

const Ctor: SRCtor | undefined =
  (window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor }).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: SRCtor }).webkitSpeechRecognition;

export const DICTATION_ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access is blocked. Allow it for this site in your browser settings.",
  "service-not-allowed": "Your browser refused the speech service.",
  "audio-capture": "No microphone found.",
  network: "The speech service couldn't be reached.",
};

interface Options {
  /** Called with each finished phrase, to append however the caller wants. */
  onPhrase: (text: string) => void;
  onError?: (message: string) => void;
  lang?: string;
}

export function useDictation({ onPhrase, onError, lang = "en-GB" }: Options) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const recRef = useRef<SRInstance | null>(null);
  // Chrome ends a "continuous" session after a pause. This tracks whether the
  // speaker still means to be dictating, so drawing breath resumes rather than
  // stopping mid-debrief.
  const wanted = useRef(false);
  const phraseRef = useRef(onPhrase);
  phraseRef.current = onPhrase;

  const stop = useCallback(() => {
    wanted.current = false;
    setListening(false);
    setInterim("");
    try { recRef.current?.stop(); } catch { /* already stopped */ }
    recRef.current = null;
  }, []);

  const start = useCallback(() => {
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e) => {
      let done = "", live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) done += r[0].transcript;
        else live += r[0].transcript;
      }
      if (done.trim()) phraseRef.current(done.trim());
      setInterim(live);
    };

    rec.onerror = (e) => {
      // Silence is a pause, not a failure. Everything else is worth saying.
      if (e.error === "no-speech" || e.error === "aborted") return;
      wanted.current = false;
      setListening(false);
      onError?.(DICTATION_ERRORS[e.error] ?? e.error);
    };

    rec.onend = () => {
      setInterim("");
      if (wanted.current) { try { rec.start(); return; } catch { /* fall through */ } }
      setListening(false);
    };

    try {
      rec.start();
      recRef.current = rec;
      wanted.current = true;
      setListening(true);
    } catch {
      onError?.("Couldn't start dictation.");
    }
  }, [lang, onError]);

  const toggle = useCallback(() => { listening ? stop() : start(); }, [listening, start, stop]);

  // Never leave the microphone live on a screen the user has left.
  useEffect(() => () => { wanted.current = false; try { recRef.current?.stop(); } catch { /* gone */ } }, []);

  return { supported: !!Ctor, listening, interim, start, stop, toggle };
}
