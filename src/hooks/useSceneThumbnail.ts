import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useSceneThumbnail(sceneId: string | null, open: boolean) {
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sceneId || !open) {
      setThumbnail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setThumbnail(null);

    (async () => {
      try {
        // Get the latest round for this scene
        const { data: rounds } = await supabase
          .from("scene_rounds")
          .select("id")
          .eq("scene_id", sceneId)
          .order("round_number", { ascending: false })
          .limit(1);

        if (cancelled || !rounds || rounds.length === 0) return;

        // Get the current upload asset for that round
        const { data: assets } = await supabase
          .from("round_assets")
          .select("storage_path, source, thumbnail_url, created_at")
          .eq("scene_round_id", rounds[0].id)
          .eq("is_current", true)
          .eq("source", "upload")
          .order("created_at", { ascending: false })
          .limit(1);

        if (cancelled || !assets || assets.length === 0) return;

        const asset = assets[0];

        if (asset.storage_path) {
          // Use round-uploads bucket — same as Portfolio page
          const { data: urlData } = supabase.storage
            .from("round-uploads")
            .getPublicUrl(asset.storage_path);
          if (!cancelled) setThumbnail(urlData.publicUrl);
        } else if (asset.thumbnail_url) {
          if (!cancelled) setThumbnail(asset.thumbnail_url);
        }
      } catch (err) {
        console.error("useSceneThumbnail error:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [sceneId, open]);

  return { thumbnail, loading };
}
