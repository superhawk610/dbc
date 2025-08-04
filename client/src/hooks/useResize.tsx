import { RefObject, useEffect, useLayoutEffect } from "react";

export interface UseResizeHook {
  minHeight: number;
  resizeRef: RefObject<HTMLElement | null>;
  resizeHandleRef: RefObject<HTMLElement | null>;
}

export default function useResize(
  { minHeight, resizeRef, resizeHandleRef }: UseResizeHook,
) {
  useLayoutEffect(() => {
    resizeRef.current!.style.height = `${minHeight}px`;
  }, []);

  useEffect(() => {
    let height = minHeight;
    let y = -1;

    function handleResize(ev: MouseEvent) {
      if (y === -1) {
        y = ev.pageY;
        return;
      }

      const diff = y - ev.pageY;
      height -= diff;
      if (height < minHeight) height = minHeight;
      resizeRef.current!.style.height = `${height}px`;

      y = ev.clientY;
    }

    function handleMouseDown(ev: MouseEvent) {
      ev.preventDefault();

      document.addEventListener("mousemove", handleResize);
      document.addEventListener("mouseup", () => {
        y = -1;
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
  }, []);
}
