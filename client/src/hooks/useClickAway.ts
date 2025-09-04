import { useEffect, useRef } from "react";

export default function useClickAway<T extends HTMLElement>(
  handler: () => void,
) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        handler();
      }
    }

    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("mousedown", handleClick);
    };
  }, [handler]);

  return ref;
}
