import { forwardRef, useImperativeHandle, useState } from "react";
import { createPortal } from "react-dom";
import { HiDatabase as AlertIcon } from "react-icons/hi";

export type AlertStyle = "default" | "info" | "success" | "warning" | "error";

export interface Alert {
  style?: AlertStyle;
  message: string;
}

interface AlertProps {
  message: string;
  style?: AlertStyle;
  onClose: () => void;
}

function Alert({ message, style, onClose }: AlertProps) {
  const styleClass = style === "info"
    ? "alert-info"
    : style === "success"
    ? "alert-success"
    : style === "warning"
    ? "alert-warning"
    : style === "error"
    ? "alert-error"
    : "";

  return (
    <div
      role="alert"
      title="Close"
      className={`alert ${styleClass} shadow-sm cursor-pointer pointer-events-auto
      select-none transition-transform hover:scale-102`}
      onClick={onClose}
    >
      <AlertIcon className="w-4 h-4" />
      <span>{message}</span>
    </div>
  );
}

export interface AlertsRef {
  addAlert: (alert: Alert) => void;
}

// deno-lint-ignore no-empty-interface
export interface Props {}

function Alerts(_props: Props, ref: React.ForwardedRef<AlertsRef>) {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useImperativeHandle(
    ref,
    () => ({
      addAlert: (alert: Alert) => setAlerts([...alerts, alert]),
    }),
  );

  return (
    <>
      {createPortal(
        <div
          className={`
          fixed pointer-events-none top-0 right-0 bottom-0 left-0 z-50 p-4
          bg-radial-[at_100%_100%] from-black/20 via-black/0 via-40% to-black/0
          transition-opacity duration-500 ease-out ${
            alerts.length > 0 ? "opacity-100" : "opacity-0"
          }`}
        >
          <div className="w-full h-full flex flex-col justify-end items-end gap-2">
            {alerts.map((alert, idx) => (
              <Alert
                key={idx}
                style={alert.style}
                message={alert.message}
                onClose={() => setAlerts(alerts.filter((_, i) => i !== idx))}
              />
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

export default forwardRef<AlertsRef, Props>(Alerts);
