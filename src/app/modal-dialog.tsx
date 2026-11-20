"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";

const DialogCloseContext = createContext<(() => void) | null>(null);

export function useDialogClose() {
  return useContext(DialogCloseContext);
}

export interface ModalDialogProps {
  open?: boolean;
  onClose: () => void;
  labelledBy?: string;
  ariaLabel?: string;
  className?: string;
  closedBy?: "any" | "closerequest" | "none";
  preventClose?: boolean;
  onClickOutsideGuard?: (event: PointerEvent) => boolean;
  children: ReactNode;
}

export function ModalDialog({
  open = true,
  onClose,
  labelledBy,
  ariaLabel,
  className,
  closedBy = "any",
  preventClose = false,
  onClickOutsideGuard,
  children,
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  const preventCloseRef = useRef(preventClose);
  const outsideGuardRef = useRef(onClickOutsideGuard);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    preventCloseRef.current = preventClose;
  }, [preventClose]);

  useEffect(() => {
    outsideGuardRef.current = onClickOutsideGuard;
  }, [onClickOutsideGuard]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = "";
      onCloseRef.current();
    };

    const handleCancel = (event: Event) => {
      if (preventCloseRef.current) {
        event.preventDefault();
      }
    };

    dialog.addEventListener("close", handleClose);
    dialog.addEventListener("cancel", handleCancel);

    return () => {
      dialog.removeEventListener("close", handleClose);
      dialog.removeEventListener("cancel", handleCancel);
    };
  }, []);

  // Safari light-dismiss fallback when <dialog closedby> is unsupported
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open || closedBy !== "any") return;
    if ("closedBy" in HTMLDialogElement.prototype) return;

    const isOutsideDialog = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && target !== dialog && dialog.contains(target)) {
        return false;
      }
      const rect = dialog.getBoundingClientRect();
      return (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      );
    };

    let pressedOutside = false;

    const handlePointerDown = (event: PointerEvent) => {
      if (preventCloseRef.current) {
        pressedOutside = false;
        return;
      }
      const openModals = document.querySelectorAll("dialog:modal");
      if (openModals[openModals.length - 1] !== dialog) {
        pressedOutside = false;
        return;
      }
      if (outsideGuardRef.current?.(event)) {
        pressedOutside = false;
        return;
      }
      pressedOutside = isOutsideDialog(event);
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (!pressedOutside) return;
      pressedOutside = false;
      if (preventCloseRef.current) return;
      if (outsideGuardRef.current?.(event)) return;
      if (isOutsideDialog(event) && dialog.open) {
        dialog.close();
      }
    };

    dialog.addEventListener("pointerdown", handlePointerDown);
    dialog.addEventListener("pointerup", handlePointerUp);

    return () => {
      dialog.removeEventListener("pointerdown", handlePointerDown);
      dialog.removeEventListener("pointerup", handlePointerUp);
    };
  }, [closedBy, open]);

  const requestClose = useCallback(() => {
    if (preventCloseRef.current) return;
    const dialog = dialogRef.current;
    if (dialog?.open) {
      dialog.close();
    } else {
      onCloseRef.current();
    }
  }, []);

  const dialogClassName = className
    ? `catalogue-dialog ${className}`
    : "catalogue-dialog";

  return (
    <DialogCloseContext.Provider value={requestClose}>
      <dialog
        ref={dialogRef}
        className={dialogClassName}
        aria-labelledby={labelledBy}
        aria-label={ariaLabel}
        {...({ closedby: closedBy } as Record<string, string>)}
      >
        {children}
      </dialog>
    </DialogCloseContext.Provider>
  );
}
