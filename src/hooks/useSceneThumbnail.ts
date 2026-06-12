import { useState, useEffect } from "react";
import { supabase, SUPABASE_URL } from "@/integrations/supabase/client";

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
        // Latest round for this scene.
        const { data: rounds } = await supabase
          .from("scene_rounds")
          .select("id")
          .eq("scene_id", sceneId)
          .order("round_number", { ascending: false })
          .limit(1);

        if (cancelled || !rounds || rounds.length === 0) return;

        // Prefer Dropbox over upload — mirrors Portfolio.tsx selection rule.
        const { data: assets } = await supabase
          .from("round_assets")
          .select("storage_path, dropbox_path, source, created_at")
          .eq("scene_round_id", rounds[0].id)
          .eq("is_current", true)
          .order("created_at", { ascending: false });

        if (cancelled || !assets || assets.length === 0) return;

        const dropboxAsset = assets.find((a: any) => a.dropbox_path);
        const uploadAsset = assets.find((a: any) => a.source === "upload" && a.storage_path);

        if (dropboxAsset) {
          const { data: sessionData } = await supabase.auth.getSession();
          const token = sessionData?.session?.access_token;
          if (!token || cancelled) return;
          const res = await fetch(
            `${SUPABASE_URL}/functions/v1/dropbox-api?action=get-thumbnail`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({ path: (dropboxAsset as any).dropbox_path, size: "w640h480" }),
            }
          );
          if (res.ok && !cancelled) {
            const data = await res.json();
            if (data.thumbnail) setThumbnail(data.thumbnail);
          }
        } else if (uploadAsset) {
          const rawPath = ((uploadAsset as any).storage_path as string).replace(/^\/+/, "");
          const { data: urlData } = supabase.storage.from("round-uploads").getPublicUrl(rawPath);
          if (!cancelled) setThumbnail(urlData.publicUrl);
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
