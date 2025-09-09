import { RefObject, useEffect, useLayoutEffect } from "react";

export interface UseResizeHook {
  active?: boolean;
  dimension: "width" | "height";
  sizes: { minimum: number; default: number };
  resizeRef: RefObject<HTMLElement | null>;
  resizeHandleRef: RefObject<HTMLElement | null>;
}

export default function useResize({
  active,
  dimension,
  sizes,
  resizeRef,
  resizeHandleRef,
}: UseResizeHook) {
  useLayoutEffect(() => {
    if (!resizeRef.current) return;
    resizeRef.current.style[dimension] = active ? `${sizes.default}px` : "";
  }, [active]);

  useEffect(() => {
    if (!resizeHandleRef.current) return;

    let size = sizes.default;
    let pos = -1;

    function handleResize(ev: MouseEvent) {
      const diff = pos - (dimension === "height" ? ev.clientY : ev.clientX);
      size -= diff;
      if (size < sizes.minimum) size = sizes.minimum;
      resizeRef.current!.style[dimension] = `${size}px`;

      pos = dimension === "height" ? ev.clientY : ev.clientX;
    }

    function handleMouseDown(ev: MouseEvent) {
      ev.preventDefault();
      pos = dimension === "height" ? ev.clientY : ev.clientX;

      document.addEventListener("mousemove", handleResize);
      document.addEventListener("mouseup", () => {
        document.removeEventListener("mousemove", handleResize);
      });
    }

    function handleDoubleClick(ev: MouseEvent) {
      ev.preventDefault();
      if (!resizeRef.current) return;
      resizeRef.current.style[dimension] = `${sizes.default}px`;
      size = sizes.default;
    }

    resizeHandleRef.current!.addEventListener("mousedown", handleMouseDown);
    resizeHandleRef.current!.addEventListener("dblclick", handleDoubleClick);

    return () => {
      resizeHandleRef.current?.removeEventListener(
        "mousedown",
        handleMouseDown,
      );
    };
  }, [active]);
}
