import React, { useRef } from "react";
import { ButtonProps, DivProps } from "react-html-props";

export function closeModal(ev: React.MouseEvent) {
  ev.preventDefault();
  ev.target.closest("dialog").close();
}

function ModalBody({ children, ...props }: DivProps) {
  return (
    <div className="py-4" {...props}>
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

function CloseModal(props: ButtonProps) {
  return (
    <form method="dialog">
      {/* if there is a button in form, it will close the modal */}
      <button className="btn" {...props}>Close</button>
    </form>
  );
}

export interface Props {
  buttonText: string;
  heading: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

function Modal(
  { buttonText, heading, children }: Props,
) {
  const dialogRef = useRef<HTMLDialogElement>();

  return (
    <>
      <button
        className="btn"
        onClick={() => dialogRef.current!.showModal()}
      >
        {buttonText}
      </button>

      <dialog ref={dialogRef} id="my_modal_1" className="modal">
        <div className="modal-box">
          <h3 className="font-bold text-lg">{heading}</h3>
          {children}
        </div>
      </dialog>
    </>
  );
}

Modal.Body = ModalBody;
Modal.Actions = ModalActions;
Modal.CloseButton = CloseModal;
export default Modal;
