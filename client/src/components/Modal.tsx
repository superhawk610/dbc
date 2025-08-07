import React, { useRef, useState } from "react";
import { DivProps } from "react-html-props";

export interface ModalActions {
  close: () => void;
}

export const closeModal =
  ({ close }: ModalActions) => (ev: React.MouseEvent) => {
    ev.preventDefault();
    (ev.target as HTMLElement)!.closest("dialog")!.close();

    // wait for modal to disappear from screen before hiding body
    setTimeout(() => close(), 1_000);
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

export interface Props {
  buttonText: React.ReactNode;
  heading: string;
  actions?: React.ReactNode;
  children: (actions: ModalActions) => React.ReactNode;
}

function Modal({ buttonText, heading, children }: Props) {
  const [showBody, setShowBody] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
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

      <dialog ref={dialogRef} className="modal">
        <div className="modal-box">
          <h3 className="font-bold text-lg">{heading}</h3>
          {showBody && children({ close: () => setShowBody(false) })}
        </div>
      </dialog>
    </>
  );
}

Modal.Body = ModalBody;
Modal.Actions = ModalActions;
export default Modal;
