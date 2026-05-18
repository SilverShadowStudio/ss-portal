import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { DURATION, FM_EASE } from "@/lib/motion";
import { X } from "lucide-react";

interface NewSceneModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (title: string) => void;
  projectName?: string;
}

// Visual language matches NewProjectModal / NewRoundModal: warm-dark
// surface, serif uppercase title, single bottom-border input, two-button
// footer. Subtitle below the title shows "Adding to {projectName}" when
// the project context is known.
export function NewSceneModal({ isOpen, onClose, onCreate, projectName }: NewSceneModalProps) {
  const [title, setTitle] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim()) {
      onCreate(title.trim());
      setTitle("");
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: "tween", duration: DURATION.quick / 1000, ease: FM_EASE.default }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 14 }}
            transition={{ type: "tween", duration: DURATION.standard / 1000, ease: FM_EASE.default }}
            className="relative w-full max-w-[480px] shadow-[0_40px_100px_-16px_rgba(0,0,0,0.6)]"
            style={{
              background: "#181614",
              border: "1px solid #2A2820",
              borderRadius: 4,
            }}
          >
            <form onSubmit={handleSubmit} style={{ padding: 48 }}>
              {/* Title row */}
              <div className="flex items-start justify-between mb-10">
                <div>
                  <h2
                    className="font-serif font-normal text-foreground uppercase"
                    style={{ fontSize: "1.85rem", letterSpacing: "0.02em", lineHeight: 1 }}
                  >
                    New Scene
                  </h2>
                  {projectName && (
                    <div className="mt-3 flex items-baseline gap-2">
                      <span
                        className="font-sans uppercase text-foreground"
                        style={{
                          fontSize: 10,
                          letterSpacing: "0.18em",
                          opacity: 0.55,
                        }}
                      >
                        Adding to
                      </span>
                      <span
                        className="font-serif italic text-foreground"
                        style={{ fontSize: 12 }}
                      >
                        {projectName}
                      </span>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="text-foreground transition-opacity"
                  style={{ opacity: 0.5, lineHeight: 1, background: "transparent", border: "none", padding: 0 }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; }}
                >
                  <X size={16} strokeWidth={1} />
                </button>
              </div>

              {/* Field */}
              <label
                htmlFor="new-scene-name"
                className="block font-sans uppercase text-foreground"
                style={{
                  fontSize: 10,
                  letterSpacing: "0.15em",
                  opacity: 0.55,
                  marginBottom: 16,
                }}
              >
                Scene name
              </label>
              <input
                id="new-scene-name"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter scene name..."
                autoFocus
                maxLength={100}
                className="w-full bg-transparent text-foreground placeholder:text-foreground/25 font-sans focus:outline-none"
                style={{
                  fontSize: 16,
                  height: 48,
                  borderBottom: "1px solid #2A2820",
                  transition: "border-color 160ms ease",
                }}
                onFocus={(e) => { e.currentTarget.style.borderBottomColor = "#B89A6A"; }}
                onBlur={(e) => { e.currentTarget.style.borderBottomColor = "#2A2820"; }}
              />

              {/* Footer */}
              <div className="flex gap-3" style={{ marginTop: 48 }}>
                <button
                  type="button"
                  onClick={onClose}
                  className="font-sans uppercase text-foreground hover:text-foreground/60 transition-colors"
                  style={{
                    height: 48,
                    paddingLeft: 24,
                    paddingRight: 24,
                    fontSize: 11,
                    letterSpacing: "0.12em",
                    opacity: 0.3,
                    background: "transparent",
                    border: "none",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!title.trim()}
                  className="flex-1 font-sans uppercase transition-opacity disabled:opacity-20 disabled:cursor-not-allowed"
                  style={{
                    height: 48,
                    fontSize: 11,
                    letterSpacing: "0.12em",
                    color: "#B89A6A",
                    background: "transparent",
                    border: "1px solid #B89A6A",
                    borderRadius: 2,
                  }}
                >
                  Create Scene
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
