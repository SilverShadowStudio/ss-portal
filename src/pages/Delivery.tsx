import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { DURATION, FM_EASE } from "@/lib/motion";
import {
  Mic, MicOff, Pencil, X, RotateCcw, Eraser,
  ChevronLeft, ChevronRight, ZoomIn, ArrowRight,
} from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { ClientLayout } from "@/components/ClientLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Task {
  id: string;
  title: string;
  description: string | null;
  delivery_status: string;
  status?: string;
  delivery_due_at: string | null;
  delivery_confirmed_at: string | null;
  delivered_at: string | null;
  feedback_submitted_at: string | null;
  lane_index: number;
  created_at: string;
  delivery_image_url?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isBusinessHours(date: Date): boolean {
  const day = date.getDay();
  const hour = date.getHours();
  return day >= 1 && day <= 5 && hour >= 10 && hour < 19;
}

function nextBusinessConfirmation(from: Date): string {
  const d = new Date(from);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  if (d.getDay() === 6) d.setDate(d.getDate() + 2);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

function formatCountdown(ms: number) {
  if (!ms || isNaN(ms)) return { days: 0, hours: 0, mins: 0, secs: 0 };
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    mins: Math.floor((total % 3600) / 60),
    secs: total % 60,
  };
}

function pad(n: number | null | undefined) {
  if (n == null || isNaN(n)) return "00";
  return Math.floor(n).toString().padStart(2, "0");
}

function formatDeliveredDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });
}

// ── Ambient background ────────────────────────────────────────────────────────

function AmbientBackground({ status }: { status: string }) {
  const isDelivered = status === "delivered";
  const isProduction = status === "in_production";

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <AnimatePresence mode="wait">
        {isDelivered && (
          <motion.div
            key="delivered-glow"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: "tween", duration: DURATION.signature / 1000, ease: FM_EASE.signature }}
            className="absolute"
            style={{
              top: "-30%",
              left: "50%",
              transform: "translateX(-50%)",
              width: "80vw",
              height: "70vh",
              background: "radial-gradient(ellipse at center, hsl(36 35% 57% / 0.07) 0%, transparent 65%)",
              filter: "blur(48px)",
            }}
          />
        )}
        {isProduction && (
          <motion.div
            key="production-glow"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: "tween", duration: DURATION.signature / 1000, ease: FM_EASE.signature }}
            className="absolute"
            style={{
              top: "-20%",
              left: "50%",
              transform: "translateX(-50%)",
              width: "70vw",
              height: "60vh",
              background: "radial-gradient(ellipse at center, hsl(142 50% 25% / 0.04) 0%, transparent 65%)",
              filter: "blur(64px)",
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Sketch Overlay ────────────────────────────────────────────────────────────

function SketchOverlay({
  imageUrl, initialSketch, onSave, onClose,
}: {
  imageUrl: string;
  initialSketch: string | null;
  onSave: (dataUrl: string) => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [eraseMode, setEraseMode] = useState(false);
  const [color, setColor] = useState("#E8C97A");
  const [lineWidth, setLineWidth] = useState(3);
  const [drawing, setDrawing] = useState(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const colors = ["#E8C97A", "#FFFFFF", "#E04F4F", "#4FD1C5", "#000000"];

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const cw = container.clientWidth;
      const ratio = img.naturalHeight / img.naturalWidth;
      canvas.width = cw;
      canvas.height = cw * ratio;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      if (initialSketch) {
        const ov = new Image();
        ov.onload = () => { ctx.drawImage(ov, 0, 0, canvas.width, canvas.height); setImgLoaded(true); };
        ov.src = initialSketch;
      } else setImgLoaded(true);
    };
    img.src = imageUrl;
  }, [imageUrl, initialSketch]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      const t = e.touches[0];
      return { x: (t.clientX - rect.left) * scaleX, y: (t.clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); setDrawing(true); lastPos.current = getPos(e); };
  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!drawing) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const pos = getPos(e);
    if (!lastPos.current) { lastPos.current = pos; return; }
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = eraseMode ? lineWidth * 6 : lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = eraseMode ? "destination-out" : "source-over";
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
    lastPos.current = pos;
  };
  const endDraw = () => { setDrawing(false); lastPos.current = null; };
  const clearSketch = () => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    if (imgRef.current) { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(imgRef.current, 0, 0, canvas.width, canvas.height); }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ type: "tween", duration: DURATION.quick / 1000, ease: FM_EASE.default }}
      className="fixed inset-0 z-[200] flex flex-col bg-background/97 backdrop-blur-xl"
    >
      <div className="flex items-center justify-between px-8 py-5 border-b border-border/20 shrink-0">
        <p className="text-[9px] font-sans uppercase tracking-[0.38em] text-foreground/35">Annotate</p>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            {colors.map((c) => (
              <button key={c} type="button" onClick={() => { setColor(c); setEraseMode(false); }}
                className="transition-all duration-quick"
                style={{ width: 13, height: 13, borderRadius: "50%", background: c, border: color === c && !eraseMode ? "2px solid rgba(255,255,255,0.9)" : "1px solid rgba(255,255,255,0.15)", transform: color === c && !eraseMode ? "scale(1.3)" : "scale(1)" }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] uppercase tracking-[0.2em] text-foreground/25">Size</span>
            <input type="range" min={1} max={10} value={lineWidth} onChange={(e) => setLineWidth(Number(e.target.value))} className="w-16 accent-gold h-0.5" />
          </div>
          <div className="h-4 w-px bg-border/30 mx-1" />
          <button type="button" onClick={() => setEraseMode((v) => !v)} className={`p-2 transition-colors ${eraseMode ? "text-gold" : "text-foreground/35 hover:text-foreground/65"}`}><Eraser size={14} strokeWidth={1.5} /></button>
          <button type="button" onClick={clearSketch} className="p-2 text-foreground/35 hover:text-foreground/65 transition-colors"><RotateCcw size={14} strokeWidth={1.5} /></button>
          <div className="h-4 w-px bg-border/30 mx-1" />
          <button type="button" onClick={onClose} className="p-2 text-foreground/30 hover:text-foreground/65 transition-colors"><X size={14} strokeWidth={1.5} /></button>
        </div>
      </div>
      <div ref={containerRef} className="flex-1 flex items-center justify-center overflow-hidden p-8">
        <canvas ref={canvasRef}
          onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
          onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw}
          className="max-w-full max-h-full object-contain"
          style={{ cursor: eraseMode ? "cell" : "crosshair", display: imgLoaded ? "block" : "none", borderRadius: 2, boxShadow: "0 32px 80px rgba(0,0,0,0.6)" }}
        />
        {!imgLoaded && <div className="flex items-center gap-3 text-foreground/30"><BrandLoader size="sm" className="h-3.5 w-3.5" /><span className="text-[10px] uppercase tracking-[0.28em]">Loading</span></div>}
      </div>
      <div className="flex items-center justify-end gap-3 px-8 py-5 border-t border-border/20 shrink-0">
        <button type="button" onClick={onClose} className="px-7 py-3 text-[10px] font-sans uppercase tracking-[0.24em] text-foreground/35 border border-border/30 hover:text-foreground/55 transition-all" style={{ borderRadius: 2 }}>Cancel</button>
        <button type="button" onClick={() => { onSave(canvasRef.current!.toDataURL("image/png")); onClose(); }} className="px-9 py-3 text-[10px] font-sans uppercase tracking-[0.24em] bg-foreground text-background hover:bg-foreground/90 transition-all" style={{ borderRadius: 2 }}>Save annotation</button>
      </div>
    </motion.div>
  );
}

// ── Countdown ─────────────────────────────────────────────────────────────────

function CountdownDigit({ value, gold }: { value: number; gold?: boolean }) {
  const display = pad(value);
  const [prev, setPrev] = useState(display);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (display !== prev) {
      setAnimating(true);
      const t = setTimeout(() => { setPrev(display); setAnimating(false); }, 250);
      return () => clearTimeout(t);
    }
  }, [display, prev]);

  return (
    <span
      className="block font-serif font-light tabular-nums"
      style={{
        fontSize: "clamp(3.5rem, 7vw, 5.5rem)",
        color: gold ? "hsl(var(--gold))" : "hsl(var(--foreground))",
        opacity: animating ? 0.35 : 1,
        transform: animating ? "translateY(-6px)" : "translateY(0)",
        transition: "opacity var(--duration-quick) var(--ease-default), transform var(--duration-quick) var(--ease-default)",
        letterSpacing: "-0.02em",
        lineHeight: 1,
      }}
    >
      {display}
    </span>
  );
}

function Countdown({ targetDate }: { targetDate: string }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const target = new Date(targetDate);
  if (isNaN(target.getTime())) return null;

  const ms = target.getTime() - now.getTime();

  if (ms <= 0) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ type: "tween", duration: DURATION.standard / 1000, ease: FM_EASE.default }}>
        <span className="font-serif font-light" style={{ fontSize: "clamp(2rem, 4vw, 3rem)", color: "hsl(var(--gold))", letterSpacing: "-0.01em" }}>
          Delivering now
        </span>
      </motion.div>
    );
  }

  const { days, hours, mins, secs } = formatCountdown(ms);

  const sep = (
    <span className="font-serif text-foreground/12 pb-9 self-end" style={{ fontSize: "clamp(2rem, 4vw, 4rem)" }}>:</span>
  );

  return (
    <div className="flex items-end gap-3 md:gap-5">
      {days > 0 && (
        <>
          <div className="flex flex-col items-center gap-3">
            <CountdownDigit value={days} />
            <span className="text-[8px] uppercase tracking-[0.4em] text-foreground/22 font-sans">Days</span>
          </div>
          {sep}
        </>
      )}
      <div className="flex flex-col items-center gap-3">
        <CountdownDigit value={hours} />
        <span className="text-[8px] uppercase tracking-[0.4em] text-foreground/22 font-sans">Hrs</span>
      </div>
      {sep}
      <div className="flex flex-col items-center gap-3">
        <CountdownDigit value={mins} />
        <span className="text-[8px] uppercase tracking-[0.4em] text-foreground/22 font-sans">Min</span>
      </div>
      {sep}
      <div className="flex flex-col items-center gap-3">
        <CountdownDigit value={secs} gold />
        <span className="text-[8px] uppercase tracking-[0.4em] font-sans" style={{ color: "hsl(var(--gold) / 0.4)" }}>Sec</span>
      </div>
    </div>
  );
}

// ── Feedback Modal ────────────────────────────────────────────────────────────

function FeedbackModal({ task, onClose, onSubmitted }: { task: Task; onClose: () => void; onSubmitted: () => void; }) {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [sketchDataUrl, setSketchDataUrl] = useState<string | null>(null);
  const [sketchOpen, setSketchOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isPolishing, setIsPolishing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef<string>("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && !sketchOpen) onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, sketchOpen]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [text]);

  const polishDictation = useCallback(async (raw: string) => {
    setIsPolishing(true);
    try {
      const res = await supabase.functions.invoke("polish-task", { body: { raw } });
      const data = res.data as { description?: string } | null;
      if (data?.description) { setText(data.description); toast.success("Dictation polished"); }
      else setText(raw);
    } catch { setText(raw); }
    finally { setIsPolishing(false); }
  }, []);

  const startDictation = useCallback(async () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { toast.error("Dictation not supported in this browser"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch { toast.error("Microphone access blocked"); return; }
    const rec = new SR();
    rec.continuous = true; rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    transcriptRef.current = "";
    rec.onresult = (e: any) => { let t = ""; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript + " "; transcriptRef.current = t; };
    rec.onerror = () => setIsRecording(false);
    rec.onend = () => { setIsRecording(false); const t = transcriptRef.current.trim(); if (t) polishDictation(t); };
    recognitionRef.current = rec;
    rec.start(); setIsRecording(true);
  }, [polishDictation]);

  const stopDictation = useCallback(() => { try { recognitionRef.current?.stop(); } catch {} }, []);

  const handleSubmit = async () => {
    if (!text.trim() && !sketchDataUrl) return;
    setSubmitting(true);
    try {
      let sketchUrl: string | null = null;
      if (sketchDataUrl && user) {
        const res = await fetch(sketchDataUrl);
        const blob = await res.blob();
        const path = `feedback/${task.id}/${Date.now()}-sketch.png`;
        const { error } = await supabase.storage.from("scene-assets").upload(path, blob);
        if (!error) { const { data } = supabase.storage.from("scene-assets").getPublicUrl(path); sketchUrl = data.publicUrl; }
      }
      await supabase.from("lane_tasks").update({
        feedback_text: text.trim() || null,
        feedback_sketch_url: sketchUrl,
        feedback_submitted_at: new Date().toISOString(),
        delivery_status: "feedback_received",
      }).eq("id", task.id);
      toast.success("Feedback submitted — we'll confirm your next delivery within 2 hours");
      onSubmitted(); onClose();
    } catch { toast.error("Could not submit feedback"); }
    finally { setSubmitting(false); }
  };

  const isFirstRound = !task.delivered_at;

  return (
    <AnimatePresence>
      {!sketchOpen && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ type: "tween", duration: DURATION.quick / 1000, ease: FM_EASE.default }} className="fixed inset-0 z-[100] flex items-end md:items-center justify-center">
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(20px)" }} onClick={onClose} />
          <motion.div
            initial={{ y: 32, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 32, opacity: 0 }}
            transition={{ type: "tween", duration: DURATION.standard / 1000, ease: FM_EASE.default }}
            className="relative w-full max-w-xl max-h-[92vh] overflow-y-auto bg-card border border-border/40 shadow-[0_48px_120px_-24px_rgba(0,0,0,0.9)]"
            style={{ borderRadius: 4 }}
          >
            <div className="px-8 pt-8 pb-6 border-b border-border/25 flex items-start justify-between">
              <div>
                <h2 className="font-serif font-normal text-foreground" style={{ fontSize: "1.55rem", letterSpacing: "-0.01em" }}>
                  {isFirstRound ? "Instructions" : "Corrections"}
                </h2>
                <p className="mt-1.5 text-[9px] uppercase tracking-[0.28em] text-foreground/35 font-sans">{task.title}</p>
              </div>
              <button type="button" onClick={onClose} className="mt-1 p-1.5 text-foreground/25 hover:text-foreground/60 transition-colors"><X size={14} strokeWidth={1.5} /></button>
            </div>

            <div className="px-8 py-7 space-y-8">
              {task.delivery_image_url && (
                <div>
                  <button type="button" onClick={() => setSketchOpen(true)} className="group w-full block relative overflow-hidden" style={{ borderRadius: 3 }}>
                    <img src={sketchDataUrl || task.delivery_image_url} alt="Current delivery" className="w-full object-cover" style={{ maxHeight: 220, objectPosition: "center", display: "block" }} />
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-quick" style={{ background: "rgba(0,0,0,0.5)" }}>
                      <div className="flex items-center gap-2 text-white">
                        <Pencil size={13} strokeWidth={1.5} />
                        <span style={{ fontSize: 9, letterSpacing: "0.3em", textTransform: "uppercase" }}>{sketchDataUrl ? "Edit annotation" : "Annotate image"}</span>
                      </div>
                    </div>
                  </button>
                  {sketchDataUrl ? (
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-[9px] font-sans uppercase tracking-wide" style={{ color: "hsl(var(--gold) / 0.7)" }}>Annotation added</p>
                      <button type="button" onClick={() => setSketchDataUrl(null)} className="text-[9px] font-sans text-foreground/30 hover:text-foreground/55 uppercase tracking-wide transition-colors">Remove</button>
                    </div>
                  ) : (
                    <p className="mt-2 text-[9px] font-sans text-foreground/25 tracking-wide">Tap the image to annotate directly</p>
                  )}
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-5">
                  <label className="text-[9px] font-sans uppercase tracking-[0.32em]" style={{ color: "hsl(var(--gold))" }}>
                    {isFirstRound ? "What do you need" : "What to change"}
                  </label>
                  <button type="button" onClick={isRecording ? stopDictation : startDictation} disabled={isPolishing}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-[9px] font-sans uppercase tracking-[0.22em] border transition-all ${isRecording ? "border-rose-500/50 text-rose-400 bg-rose-500/5" : "border-border/35 text-foreground/30 hover:border-foreground/25 hover:text-foreground/55"}`}
                    style={{ borderRadius: 2 }}
                  >
                    {isPolishing ? <BrandLoader size="sm" className="h-2.5 w-2.5" /> : isRecording ? <MicOff size={9} /> : <Mic size={9} />}
                    {isPolishing ? "Polishing" : isRecording ? "Stop" : "Dictate"}
                  </button>
                </div>
                <textarea ref={textareaRef} value={text} onChange={(e) => setText(e.target.value)}
                  placeholder={isFirstRound ? "Describe the image you want us to create…" : "Describe exactly what needs to change…"}
                  autoFocus rows={4}
                  className="w-full bg-transparent text-foreground placeholder:text-foreground/18 text-[13.5px] font-sans leading-relaxed focus:outline-none resize-none border-b border-border/25 pb-4 focus:border-foreground/20 transition-colors"
                  style={{ overflow: "hidden" }}
                />
                <p className="mt-3 text-[9px] font-sans text-foreground/22 leading-relaxed">Precision in your instructions is precision in the output.</p>
              </div>
            </div>

            <div className="px-8 pb-8 flex gap-3">
              <button type="button" onClick={onClose} className="flex-1 py-4 text-[10px] font-sans uppercase tracking-[0.24em] text-foreground/30 border border-border/30 hover:text-foreground/50 hover:border-border/50 transition-all" style={{ borderRadius: 2 }}>Cancel</button>
              <button type="button" onClick={handleSubmit} disabled={(!text.trim() && !sketchDataUrl) || submitting}
                className="flex-[2] py-4 text-[10px] font-sans uppercase tracking-[0.24em] bg-foreground text-background hover:bg-foreground/90 transition-all disabled:opacity-20 disabled:cursor-not-allowed"
                style={{ borderRadius: 2 }}
              >
                {submitting ? <span className="flex items-center justify-center gap-2"><BrandLoader size="sm" className="h-2.5 w-2.5" />Submitting</span> : "Submit feedback"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
      {sketchOpen && task.delivery_image_url && (
        <SketchOverlay imageUrl={task.delivery_image_url} initialSketch={sketchDataUrl} onSave={(url) => setSketchDataUrl(url)} onClose={() => setSketchOpen(false)} />
      )}
    </AnimatePresence>
  );
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[150] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.95)", backdropFilter: "blur(20px)" }}
      onClick={onClose}
    >
      <button type="button" className="absolute top-6 right-6 p-2 text-white/30 hover:text-white/70 transition-colors" onClick={onClose}><X size={16} strokeWidth={1.5} /></button>
      <motion.img initial={{ scale: 0.97, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.97, opacity: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        src={url} alt="" className="max-w-full max-h-full object-contain"
        style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 2 }}
        onClick={(e) => e.stopPropagation()}
      />
    </motion.div>
  );
}

// ── Delivery image block ──────────────────────────────────────────────────────

function DeliveryImageBlock({ task, isDelivered }: { task: Task; isDelivered?: boolean }) {
  const [zoomed, setZoomed] = useState(false);
  if (!task.delivery_image_url) return null;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, scale: 0.99 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        className="mb-10 relative group"
      >
        {isDelivered && (
          <div className="absolute inset-0 pointer-events-none z-10" style={{ borderRadius: 6, boxShadow: "0 0 0 1px hsl(var(--gold) / 0.12), 0 48px 100px -20px rgba(0,0,0,0.6)" }} />
        )}
        <button type="button" onClick={() => setZoomed(true)} className="w-full block relative overflow-hidden" style={{ borderRadius: 6 }}>
          <img src={task.delivery_image_url} alt={task.title} className="w-full object-cover transition-transform duration-1000 group-hover:scale-[1.01]" style={{ maxHeight: 560, display: "block" }} />
          <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.18) 0%, transparent 30%)" }} />
          <div className="absolute top-4 right-4 p-2 opacity-0 group-hover:opacity-100 transition-all duration-300" style={{ background: "rgba(0,0,0,0.38)", borderRadius: 3 }}>
            <ZoomIn size={12} strokeWidth={1.5} className="text-white/60" />
          </div>
        </button>
      </motion.div>
      <AnimatePresence>
        {zoomed && <Lightbox url={task.delivery_image_url} onClose={() => setZoomed(false)} />}
      </AnimatePresence>
    </>
  );
}

// ── Previous Deliveries ───────────────────────────────────────────────────────

function PreviousDeliveries({ tasks, onZoom }: { tasks: Task[]; onZoom: (url: string) => void }) {
  const [page, setPage] = useState(0);
  const perPage = 3;
  const totalPages = Math.ceil(tasks.length / perPage);
  const visible = tasks.slice(page * perPage, page * perPage + perPage);
  if (tasks.length === 0) return null;

  return (
    <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="mt-24 mb-20">
      <div className="flex items-center gap-4 mb-6">
        <div className="h-px flex-1 bg-border/12" />
        <span className="text-[9px] font-sans uppercase tracking-[0.32em] text-foreground/22">Previous deliveries</span>
        <span className="text-[9px] font-sans text-foreground/15">{tasks.length}</span>
        {totalPages > 1 && (
          <>
            <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="p-1 text-foreground/18 hover:text-foreground/40 disabled:opacity-15 transition-colors"><ChevronLeft size={12} strokeWidth={1.5} /></button>
            <button type="button" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="p-1 text-foreground/18 hover:text-foreground/40 disabled:opacity-15 transition-colors"><ChevronRight size={12} strokeWidth={1.5} /></button>
          </>
        )}
        <div className="h-px flex-1 bg-border/12" />
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={page} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }} className="grid grid-cols-3 gap-2">
          {visible.map((task) => (
            <button key={task.id} type="button" onClick={() => task.delivery_image_url && onZoom(task.delivery_image_url)}
              className="group relative overflow-hidden bg-card border border-border/12 hover:border-border/30 transition-all duration-300"
              style={{ borderRadius: 3, aspectRatio: "4/3" }}
            >
              {task.delivery_image_url ? (
                <>
                  <img src={task.delivery_image_url} alt={task.title} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.05]" />
                  <div className="absolute inset-0 flex flex-col justify-end p-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.6), transparent)" }}>
                    <span className="text-[9px] text-white/65 font-sans uppercase tracking-[0.15em] truncate">{task.title}</span>
                    {task.delivered_at && <span className="text-[8px] text-white/30 font-sans mt-0.5">{formatDeliveredDate(task.delivered_at)}</span>}
                  </div>
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-[9px] text-foreground/12 uppercase tracking-widest font-sans">No image</span>
                </div>
              )}
            </button>
          ))}
        </motion.div>
      </AnimatePresence>
    </motion.section>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Delivery() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedbackTask, setFeedbackTask] = useState<Task | null>(null);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    if (!user) return;
    try {
      const { data: member } = await supabase.from("account_members").select("account_id").eq("user_id", user.id).maybeSingle();
      if (!member?.account_id) return;
      const { data } = await supabase.from("lane_tasks").select("*").eq("account_id", member.account_id).not("status", "eq", "cancelled").order("created_at", { ascending: false });
      setTasks((data || []) as Task[]);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase.channel("delivery-updates").on("postgres_changes", { event: "*", schema: "public", table: "lane_tasks" }, fetchTasks).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, fetchTasks]);

  const STATUS_PRIORITY: Record<string, number> = { delivered: 4, in_production: 3, feedback_received: 2, pending_validation: 1 };
  const activeTask = tasks
    .filter((t) => t.status !== "completed" && t.status !== "cancelled")
    .sort((a, b) => (STATUS_PRIORITY[b.delivery_status] ?? 0) - (STATUS_PRIORITY[a.delivery_status] ?? 0))[0] ?? null;
  const previousTasks = tasks.filter((t) => t.delivered_at && t.id !== activeTask?.id);
  const activeStatus = activeTask?.delivery_status ?? "";

  const statusDotClass = () => {
    switch (activeStatus) {
      case "in_production": return "bg-emerald-500 shadow-[0_0_6px_hsl(142_71%_45%/0.6)]";
      case "delivered": return "bg-[hsl(var(--gold))] shadow-[0_0_8px_hsl(var(--gold)/0.65)] animate-pulse";
      default: return "bg-foreground/18";
    }
  };

  const statusLabel = () => {
    switch (activeStatus) {
      case "pending_validation": return "In validation";
      case "in_production": return "In production";
      case "delivered": return "Ready for review";
      case "feedback_received": return "Feedback received";
      default: return "Queued";
    }
  };

  if (loading) {
    return (
      <ClientLayout>
        <div className="flex items-center justify-center min-h-[70vh]">
          <BrandLoader size="sm" />
        </div>
      </ClientLayout>
    );
  }

  return (
    <ClientLayout>
      {/* Ambient */}
      <AmbientBackground status={activeStatus} />

      <div className="relative z-10">
        {/* Page header */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="mb-16">
          <div className="flex items-center gap-4 mb-5">
            <div className="h-px w-8 bg-gold-muted" />
            <span className="text-[9px] uppercase tracking-[0.42em] font-sans" style={{ color: "hsl(var(--gold))" }}>Production</span>
          </div>
          <h1 className="font-serif font-light text-foreground" style={{ fontSize: "clamp(2.2rem, 4vw, 3rem)", letterSpacing: "0.02em" }}>
            Deliveries
          </h1>
        </motion.div>

        {/* Empty */}
        {tasks.length === 0 && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="py-32">
            <div className="flex items-center gap-4 mb-8">
              <div className="h-px w-8 bg-gold-muted" />
              <span className="text-[9px] uppercase tracking-[0.38em] font-sans text-foreground/22">Nothing in production</span>
            </div>
            <p className="font-serif text-foreground/25 font-light" style={{ fontSize: "1.6rem" }}>No active work</p>
            <p className="mt-3 text-[11px] font-sans text-foreground/20 tracking-wide leading-relaxed" style={{ maxWidth: 340 }}>
              Submit a task from the Timeline page and it will appear here once scheduled into production.
            </p>
          </motion.div>
        )}

        {/* Active task */}
        {activeTask && (
          <div>
            {/* Status row */}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: 0.05 }} className="flex items-center gap-3 mb-8">
              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${statusDotClass()}`} />
              <span className="text-[9px] uppercase tracking-[0.32em] text-foreground/38 font-sans">{statusLabel()}</span>
              <span className="text-foreground/12 text-[9px] font-sans">·</span>
              <span className="text-[9px] uppercase tracking-[0.22em] text-foreground/22 font-sans">Lane {pad(activeTask.lane_index)}</span>
            </motion.div>

            {/* Task title */}
            <motion.h2
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.65, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
              className="font-serif font-light text-foreground mb-14"
              style={{ fontSize: "clamp(1.8rem, 3.5vw, 2.6rem)", letterSpacing: "-0.01em", lineHeight: 1.12 }}
            >
              {activeTask.title}
            </motion.h2>

            {/* In production */}
            {activeStatus === "in_production" && (
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>
                <p className="text-[9px] uppercase tracking-[0.38em] text-foreground/22 font-sans mb-8">Next delivery in</p>
                {activeTask.delivery_due_at && <Countdown targetDate={activeTask.delivery_due_at} />}
                <div className="mt-14">
                  <button type="button" onClick={() => setFeedbackTask(activeTask)}
                    className="text-[9px] font-sans uppercase tracking-[0.28em] text-foreground/22 hover:text-foreground/45 transition-colors border-b border-foreground/8 hover:border-foreground/22 pb-0.5"
                  >
                    Submit new instructions
                  </button>
                </div>
              </motion.div>
            )}

            {/* Delivered */}
            {activeStatus === "delivered" && (
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>
                <DeliveryImageBlock task={activeTask} isDelivered />

                {/* Delivery notice */}
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }} className="mb-10">
                  <div className="flex items-center gap-4 mb-3">
                    <div className="h-px w-6 bg-gold-muted" />
                    <span className="text-[9px] uppercase tracking-[0.38em] font-sans text-gold-muted">Delivery ready</span>
                    <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: "hsl(var(--gold))", boxShadow: "0 0 8px hsl(var(--gold) / 0.55)" }} />
                  </div>
                  {activeTask.delivered_at && (
                    <p className="text-[9px] uppercase tracking-[0.22em] text-foreground/22 font-sans ml-10">
                      {formatDeliveredDate(activeTask.delivered_at)}
                    </p>
                  )}
                </motion.div>

                {/* CTA */}
                <motion.button
                  type="button"
                  onClick={() => setFeedbackTask(activeTask)}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.3 }}
                  className="group w-full flex items-center justify-between px-8 py-5 font-sans text-[10px] uppercase tracking-[0.3em] bg-foreground text-background hover:bg-foreground/92 transition-all"
                  style={{ borderRadius: 3 }}
                >
                  <span>Submit corrections</span>
                  <ArrowRight size={13} strokeWidth={1.5} className="transition-transform duration-200 group-hover:translate-x-1.5" />
                </motion.button>
              </motion.div>
            )}

            {/* Pending / feedback received */}
            {(activeStatus === "pending_validation" || activeStatus === "feedback_received") && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
                <div className="flex items-center gap-4 mb-6">
                  <div className="h-px w-6 bg-border/25" />
                  <span className="text-[9px] uppercase tracking-[0.38em] text-foreground/28 font-sans">
                    {activeStatus === "feedback_received" ? "Feedback received" : "Awaiting confirmation"}
                  </span>
                </div>
                <p className="font-serif font-light text-foreground/48 ml-10" style={{ fontSize: "1.15rem", letterSpacing: "-0.005em" }}>
                  {activeStatus === "feedback_received"
                    ? "We have your corrections. Delivery confirmation to follow shortly."
                    : isBusinessHours(new Date())
                      ? "Delivery confirmed within 2 hours"
                      : `Confirmed on ${nextBusinessConfirmation(new Date())} by 12:00`}
                </p>
              </motion.div>
            )}
          </div>
        )}

        {/* Previous deliveries */}
        <PreviousDeliveries tasks={previousTasks} onZoom={setZoomedImage} />
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {zoomedImage && <Lightbox url={zoomedImage} onClose={() => setZoomedImage(null)} />}
      </AnimatePresence>

      {/* Feedback modal */}
      <AnimatePresence>
        {feedbackTask && (
          <FeedbackModal task={feedbackTask} onClose={() => setFeedbackTask(null)} onSubmitted={fetchTasks} />
        )}
      </AnimatePresence>
    </ClientLayout>
  );
}
