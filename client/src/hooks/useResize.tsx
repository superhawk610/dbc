import { RefObject, useEffect, useLayoutEffect } from "react";

export interface UseResizeHook {
  active?: boolean;
  minHeight: number;
  defaultHeight: number;
  resizeRef: RefObject<HTMLElement | null>;
  resizeHandleRef: RefObject<HTMLElement | null>;
}

export default function useResize(
  { active, minHeight, defaultHeight, resizeRef, resizeHandleRef }:
    UseResizeHook,
) {
  useLayoutEffect(() => {
    resizeRef.current!.style.height = active ? `${defaultHeight}px` : "";
  }, [active]);

  useEffect(() => {
    if (!resizeHandleRef.current) return;

    let height = defaultHeight;
    let y = -1;

    function handleResize(ev: MouseEvent) {
      const diff = y - ev.clientY;
      height -= diff;
      if (height < minHeight) height = minHeight;
      resizeRef.current!.style.height = `${height}px`;

      y = ev.clientY;
    }

    function handleMouseDown(ev: MouseEvent) {
      ev.preventDefault();
      y = ev.clientY;

      document.addEventListener("mousemove", handleResize);
      document.addEventListener("mouseup", () => {
        document.removeEventListener("mousemove", handleResize);
      });
    }

    resizeHandleRef.current!.addEventListener("mousedown", handleMouseDown);

    return () => {
      resizeHandleRef.current?.removeEventListener(
        "mousedown",
        handleMouseDown,
      );
    };
  }, [active]);
}
