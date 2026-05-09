import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus } from "lucide-react";

interface NewSceneModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (title: string) => void;
  projectName?: string;
}

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
            onClick={onClose}
            className="absolute inset-0 bg-background/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2 }}
            className="relative bg-card border border-border rounded-3xl p-8 w-full max-w-lg shadow-2xl"
          >
            <form onSubmit={handleSubmit}>
              <h2 className="text-2xl font-medium mb-2 font-serif">New scene</h2>
              {projectName && (
                <p className="text-sm text-muted-foreground mb-8 font-sans">
                  Adding to <span className="text-foreground font-medium">{projectName}</span>
                </p>
              )}

              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter scene name..."
                autoFocus
                maxLength={100}
                className="w-full p-4 rounded-2xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all font-sans"
              />

              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 p-4 rounded-xl border border-border text-foreground text-sm font-medium hover:bg-muted transition-colors font-sans"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!title.trim()}
                  className="flex-1 flex items-center justify-center gap-2 p-4 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed font-sans"
                >
                  <Plus size={18} />
                  Create scene
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}