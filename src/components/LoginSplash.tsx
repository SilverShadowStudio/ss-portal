import { useEffect, useState } from "react";
import silvershadowLogo from "@/assets/silvershadow-logo.png";

interface LoginSplashProps {
  onComplete: () => void;
}

export default function LoginSplash({ onComplete }: LoginSplashProps) {
  const [showLine, setShowLine] = useState(false);
  const [lineProgress, setLineProgress] = useState(0);

  useEffect(() => {
    // Show line after logo starts fading in
    const lineTimer = setTimeout(() => {
      setShowLine(true);
    }, 600);

    // Animate line growth
    const lineGrowthTimer = setTimeout(() => {
      setLineProgress(100);
    }, 650);

    // Complete after 3 seconds total
    const completeTimer = setTimeout(() => {
      onComplete();
    }, 3000);

    return () => {
      clearTimeout(lineTimer);
      clearTimeout(lineGrowthTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background">
      {/* Logo - same as login page */}
      <div className="animate-splash-rise">
        <img 
          src={silvershadowLogo} 
          alt="Silver Shadow Studio" 
          className="h-10 w-auto brightness-0 invert-0 dark:invert md:h-12"
        />
      </div>

      {/* Gold line - growing from center outward, doubled thickness */}
      <div className="mt-8 h-px w-32 flex items-center justify-center overflow-hidden">
        <div
          className="h-full bg-gold transition-all duration-signature ease-signature"
          style={{
            width: showLine ? `${lineProgress}%` : '0%',
          }}
        />
      </div>
    </div>
  );
}
