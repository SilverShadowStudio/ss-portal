import { useRef, forwardRef, useImperativeHandle } from "react";
import SignatureCanvas from "react-signature-canvas";

export interface SignaturePadRef {
  clear: () => void;
  isEmpty: () => boolean;
  toDataURL: () => string;
}

interface SignaturePadProps {
  onEnd?: () => void;
}

const SignaturePad = forwardRef<SignaturePadRef, SignaturePadProps>(
  ({ onEnd }, ref) => {
    const sigCanvas = useRef<SignatureCanvas>(null);

    useImperativeHandle(ref, () => ({
      clear: () => {
        sigCanvas.current?.clear();
      },
      isEmpty: () => {
        return sigCanvas.current?.isEmpty() ?? true;
      },
      toDataURL: () => {
        return sigCanvas.current?.toDataURL("image/png") ?? "";
      },
    }));

    return (
      <div className="border border-muted-foreground/30 rounded-sm bg-white/5">
        <SignatureCanvas
          ref={sigCanvas}
          penColor="#e8e0d4"
          canvasProps={{
            className: "w-full h-40",
            style: { width: "100%", height: "160px" },
          }}
          onEnd={onEnd}
        />
      </div>
    );
  }
);

SignaturePad.displayName = "SignaturePad";

export default SignaturePad;
