import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { DivProps } from "react-html-props";

export interface ModalActions {
  // If `notify` is false, the parent's `onClose` prop will not be called.
  close: (notify: boolean) => void;
}

export const closeModal =
  ({ close }: ModalActions) => (ev: React.MouseEvent, notify = true) => {
    ev.preventDefault();
    (ev.target as HTMLElement)!.closest("dialog")!.close();

    // wait for modal to disappear from screen before hiding body
    setTimeout(() => close(notify), 1_000);
  };

function ModalBody({ children, ...props }: DivProps) {
  return (
    <div className="pt-4" {...props}>
      {children}
    </div>
  );
}

function ModalActions({ children, className, ...props }: DivProps) {
  return (
    <div className={`modal-action ${className}`} {...props}>
      {children}
    </div>
  );
}

export interface ModalControlProps {
  // direct control
  active?: boolean;
  onClose?: () => void;
}

export interface Props extends ModalControlProps {
  heading: string;
  actions?: React.ReactNode;
  children: (actions: ModalActions) => React.ReactNode;
  size?: "default" | "medium" | "large";

  // managed control
  buttonText?: React.ReactNode;
}

function Modal(
  { buttonText, heading, children, size = "default", active, onClose }: Props,
) {
  const [showBody, setShowBody] = useState(active ?? false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (active) setShowBody(true);
  }, [active]);

  useLayoutEffect(() => {
    if (active) dialogRef.current!.showModal();
  }, [active]);

  return (
    <>
      {typeof active === "undefined" && (
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            setShowBody(true);

            // try to let body render before showing
            setTimeout(() => dialogRef.current!.showModal(), 0);
          }}
        >
          {buttonText}
        </button>
      )}

      <dialog ref={dialogRef} className="modal">
        <div
          className={`modal-box ${
            size === "large"
              ? "max-w-[800px]"
              : size === "medium"
              ? "max-w-[600px]"
              : ""
          }`}
        >
          <h3 className="font-bold text-lg">{heading}</h3>
          {showBody && children({
            close: (notify: boolean) => {
              setShowBody(false);
              if (notify) onClose?.();
            },
          })}
        </div>
      </dialog>
    </>
  );
}

Modal.Body = ModalBody;
Modal.Actions = ModalActions;
export default Modal;
