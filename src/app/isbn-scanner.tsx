"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { DecodeHintType } from "@zxing/library";
import { detectIsbn } from "@/lib/books/lookup";

type DetectedBarcode = {
  rawValue?: string;
};

type NativeBarcodeDetectorInstance = {
  detect: (source: ImageBitmapSource) => Promise<DetectedBarcode[]>;
};

type NativeBarcodeDetectorConstructor = {
  new (options?: { formats?: string[] }): NativeBarcodeDetectorInstance;
  getSupportedFormats?: () => Promise<string[]>;
};

type ScannerControls = {
  stop: () => void;
};

type CameraState =
  | { status: "starting"; message: string }
  | { status: "active"; engine: "native" | "zxing"; message: string }
  | { status: "unavailable" | "error"; message: string };

const ISBN_BARCODE_FORMATS = ["ean_13", "ean_8"] as const;

async function createNativeBarcodeDetector(): Promise<NativeBarcodeDetectorInstance | null> {
  if (typeof window === "undefined") {
    return null;
  }

  const DetectorCtor = (
    window as unknown as {
      BarcodeDetector?: NativeBarcodeDetectorConstructor;
    }
  ).BarcodeDetector;

  if (typeof DetectorCtor !== "function") {
    return null;
  }

  try {
    if (typeof DetectorCtor.getSupportedFormats === "function") {
      const supported = await DetectorCtor.getSupportedFormats();
      const formats = ISBN_BARCODE_FORMATS.filter((format) =>
        supported.includes(format),
      );
      if (formats.length === 0) {
        return null;
      }
      return new DetectorCtor({ formats });
    }

    return new DetectorCtor({ formats: [...ISBN_BARCODE_FORMATS] });
  } catch {
    return null;
  }
}

function describeCameraError(error: unknown): string {
  const name =
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    typeof error.name === "string"
      ? error.name
      : "";

  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Camera permission was denied. Allow camera access or scan a barcode from a photo below.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera was found on this device. Use the photo upload option below instead.";
    case "NotReadableError":
    case "TrackStartError":
      return "Your camera is in use by another app. Close it or scan a barcode from a photo below.";
    case "OverconstrainedError":
      return "Could not match rear camera settings. Use the photo upload option below instead.";
    default:
      return "Live camera scanning could not start. You can still scan an ISBN barcode from a photo below.";
  }
}

export default function IsbnScanner({
  onDetected,
  onClose,
}: {
  onDetected: (isbn: string) => void;
  onClose: () => void;
}) {
  const headingId = useId();
  const fileInputId = useId();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<ScannerControls | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const detectedRef = useRef(false);
  const onDetectedRef = useRef(onDetected);

  const [cameraState, setCameraState] = useState<CameraState>({
    status: "starting",
    message: "Starting camera for ISBN barcode scan...",
  });
  const [isDecodingPhoto, setIsDecodingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [detectedMessage, setDetectedMessage] = useState("");

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  const stopLiveScanner = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    if (controlsRef.current) {
      try {
        controlsRef.current.stop();
      } catch {
        // Ignore cleanup errors when stopping ZXing scanner controls
      }
      controlsRef.current = null;
    }

    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        try {
          track.stop();
        } catch {
          // Ignore track stop errors during unmount
        }
      }
      streamRef.current = null;
    }

    if (videoRef.current) {
      try {
        videoRef.current.srcObject = null;
      } catch {
        // Ignore video reset errors
      }
    }
  }, []);

  const completeDetection = useCallback(
    (isbn: string) => {
      if (detectedRef.current) {
        return;
      }
      detectedRef.current = true;
      stopLiveScanner();
      setPhotoError("");
      setDetectedMessage(`Scanned ISBN ${isbn}.`);
      onDetectedRef.current(isbn);
    },
    [stopLiveScanner],
  );

  useEffect(() => {
    let cancelled = false;
    detectedRef.current = false;

    const startCameraScanner = async () => {
      if (typeof window !== "undefined" && !window.isSecureContext) {
        setCameraState({
          status: "unavailable",
          message:
            "Live camera scanning requires HTTPS (or localhost). Scan a back-cover barcode from a photo below.",
        });
        return;
      }

      if (
        typeof navigator === "undefined" ||
        typeof navigator.mediaDevices?.getUserMedia !== "function"
      ) {
        setCameraState({
          status: "unavailable",
          message:
            "Live camera access is unavailable in this browser. Scan a back-cover barcode from a photo below.",
        });
        return;
      }

      let acquiredStream: MediaStream | null = null;
      try {
        acquiredStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });

        if (cancelled || detectedRef.current) {
          for (const track of acquiredStream.getTracks()) {
            track.stop();
          }
          return;
        }

        streamRef.current = acquiredStream;

        const nativeDetector = await createNativeBarcodeDetector();
        if (cancelled || detectedRef.current) {
          stopLiveScanner();
          return;
        }

        const videoElement = videoRef.current;
        if (!videoElement) {
          stopLiveScanner();
          return;
        }

        if (nativeDetector) {
          videoElement.srcObject = acquiredStream;
          try {
            await videoElement.play();
          } catch {
            // Video autoplay may resolve lazily once frames arrive
          }

          if (cancelled || detectedRef.current) {
            stopLiveScanner();
            return;
          }

          setCameraState({
            status: "active",
            engine: "native",
            message:
              "Point the camera at the EAN-13 / ISBN barcode on the back cover.",
          });

          const scanFrame = async () => {
            if (cancelled || detectedRef.current || !videoRef.current) {
              return;
            }

            const video = videoRef.current;
            if (video.readyState >= 2 && video.videoWidth > 0) {
              try {
                const barcodes = await nativeDetector.detect(video);
                for (const barcode of barcodes) {
                  const rawValue = barcode.rawValue ?? "";
                  const isbn = rawValue ? detectIsbn(rawValue) : null;
                  if (isbn) {
                    completeDetection(isbn);
                    return;
                  }
                }
              } catch {
                // Ignore transient per-frame detection errors
              }
            }

            if (!cancelled && !detectedRef.current) {
              pollTimerRef.current = window.setTimeout(() => {
                void scanFrame();
              }, 160);
            }
          };

          pollTimerRef.current = window.setTimeout(() => {
            void scanFrame();
          }, 160);
          return;
        }

        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] =
          await Promise.all([
            import("@zxing/browser"),
            import("@zxing/library"),
          ]);

        if (cancelled || detectedRef.current || !videoRef.current) {
          stopLiveScanner();
          return;
        }

        const hints = new Map<DecodeHintType, unknown>();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
        ]);

        const reader = new BrowserMultiFormatReader(hints);
        const controls = await reader.decodeFromStream(
          acquiredStream,
          videoRef.current,
          (result) => {
            if (cancelled || detectedRef.current) {
              return;
            }
            const rawText = result?.getText();
            if (!rawText) {
              return;
            }
            const isbn = detectIsbn(rawText);
            if (isbn) {
              completeDetection(isbn);
            }
          },
        );

        if (cancelled || detectedRef.current) {
          controls.stop();
          stopLiveScanner();
          return;
        }

        controlsRef.current = controls;
        setCameraState({
          status: "active",
          engine: "zxing",
          message:
            "Point the camera at the EAN-13 / ISBN barcode on the back cover.",
        });
      } catch (error) {
        if (acquiredStream) {
          for (const track of acquiredStream.getTracks()) {
            track.stop();
          }
        }
        stopLiveScanner();
        if (!cancelled) {
          setCameraState({
            status: "error",
            message: describeCameraError(error),
          });
        }
      }
    };

    void startCameraScanner();

    return () => {
      cancelled = true;
      stopLiveScanner();
    };
  }, [completeDetection, stopLiveScanner]);

  const handlePhotoChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    setPhotoError("");
    setIsDecodingPhoto(true);
    const objectUrl = URL.createObjectURL(file);

    try {
      if (typeof createImageBitmap === "function") {
        const nativeDetector = await createNativeBarcodeDetector();
        if (nativeDetector) {
          let bitmap: ImageBitmap | null = null;
          try {
            bitmap = await createImageBitmap(file);
            const barcodes = await nativeDetector.detect(bitmap);
            for (const barcode of barcodes) {
              const rawValue = barcode.rawValue ?? "";
              const isbn = rawValue ? detectIsbn(rawValue) : null;
              if (isbn) {
                completeDetection(isbn);
                return;
              }
            }
          } catch {
            // Fall back cleanly to @zxing/browser decoding
          } finally {
            bitmap?.close();
          }
        }
      }

      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] =
        await Promise.all([
          import("@zxing/browser"),
          import("@zxing/library"),
        ]);

      const hints = new Map<DecodeHintType, unknown>();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
      ]);
      hints.set(DecodeHintType.TRY_HARDER, true);

      const reader = new BrowserMultiFormatReader(hints);
      const result = await reader.decodeFromImageUrl(objectUrl);
      const rawText = result?.getText() ?? "";
      const isbn = rawText ? detectIsbn(rawText) : null;

      if (isbn) {
        completeDetection(isbn);
        return;
      }

      setPhotoError(
        "Found a barcode in the photo, but it did not contain a valid ISBN-10 or ISBN-13.",
      );
    } catch {
      setPhotoError(
        "No readable ISBN barcode was found in that photo. Try a sharper close-up of the back-cover barcode.",
      );
    } finally {
      URL.revokeObjectURL(objectUrl);
      setIsDecodingPhoto(false);
    }
  };

  const showVideoFrame =
    cameraState.status === "starting" || cameraState.status === "active";

  return (
    <section className="isbn-scanner-panel" aria-labelledby={headingId}>
      <div className="isbn-scanner-header">
        <div>
          <h4 id={headingId}>ISBN Barcode Scanner</h4>
          <p className="isbn-scanner-hint">{cameraState.message}</p>
        </div>
        <button
          type="button"
          className="pathfinder-btn btn-secondary font-mono isbn-scanner-close-btn"
          onClick={() => {
            stopLiveScanner();
            onClose();
          }}
        >
          Close
        </button>
      </div>

      {showVideoFrame && (
        <div className="isbn-scanner-video-frame">
          <video
            ref={videoRef}
            className="isbn-scanner-video"
            playsInline
            muted
            autoPlay
            aria-label="Live camera preview for ISBN barcode scanning"
          />
          <div className="isbn-scanner-reticle" aria-hidden="true" />
        </div>
      )}

      {(cameraState.status === "error" ||
        cameraState.status === "unavailable") && (
        <p
          className="isbn-scanner-notice"
          role={cameraState.status === "error" ? "alert" : undefined}
        >
          {cameraState.message}
        </p>
      )}

      <div className="isbn-scanner-photo-fallback">
        <label htmlFor={fileInputId} className="isbn-photo-label">
          Scan barcode from photo
        </label>
        <input
          id={fileInputId}
          type="file"
          accept="image/*"
          capture="environment"
          className="isbn-photo-input"
          disabled={isDecodingPhoto}
          onChange={(event) => void handlePhotoChange(event)}
        />
        {isDecodingPhoto && (
          <p className="isbn-photo-progress">Scanning barcode image…</p>
        )}
      </div>

      {photoError && (
        <p className="editor-error isbn-scanner-error" role="alert">
          {photoError}
        </p>
      )}

      {detectedMessage && (
        <p className="editor-lookup-status font-mono" role="status">
          {detectedMessage}
        </p>
      )}
    </section>
  );
}
