import { useRef, forwardRef, useImperativeHandle } from "react";
import SignatureCanvas from "react-signature-canvas";

export interface SignaturePadRef {
  clear: () => void;
  isEmpty: () => boolean;
  toDataURL: () => string;
}

interface SignaturePadProps {
  onEnd?: () => void;
  /** Optional pen colour override. Defaults to the cream tone used on the
   *  portal's dark surfaces. The v3 client agreement page passes warm black
   *  (`#1A1814`) for the cream document surface. */
  penColor?: string;
  /** Optional container className override for the wrapper. Defaults to the
   *  cream-on-dark style used in the existing freelancer/quotation flows. */
  containerClassName?: string;
}

const SignaturePad = forwardRef<SignaturePadRef, SignaturePadProps>(
  ({ onEnd, penColor, containerClassName }, ref) => {
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
      <div className={containerClassName ?? "border border-muted-foreground/30 rounded-sm bg-white/5"}>
        <SignatureCanvas
          ref={sigCanvas}
          penColor={penColor ?? "#e8e0d4"}
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
