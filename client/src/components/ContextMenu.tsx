import { useState } from "react";
import { createPortal } from "react-dom";
import useClickAway from "../hooks/useClickAway.ts";

export interface ContextMenuHook {
  props: HookProps;
  onContextMenu: (ctx: ItemContext) => (ev: React.MouseEvent) => void;
}

// deno-lint-ignore no-explicit-any
type ItemContext = any;

export function useContextMenu(): ContextMenuHook {
  const [active, setActive] = useState<{ x: number; y: number } | null>(null);
  const [itemContext, setItemContext] = useState<ItemContext | null>(null);

  const onContextMenu = (ctx: ItemContext) => (ev: React.MouseEvent) => {
    ev.preventDefault();
    setActive({ x: ev.clientX, y: ev.clientY });
    setItemContext(ctx);
  };

  return {
    onContextMenu,
    props: {
      active: active !== null,
      x: active?.x,
      y: active?.y,
      itemContext,
      onClose: () => setActive(null),
    },
  };
}

export interface Item {
  id: string | "divider";
  // required unless `id` is "divider"
  label?: string;
  disabled?: boolean;
}

export interface HookProps {
  active: boolean;
  onClose: () => void;
  x: number | undefined;
  y: number | undefined;
  itemContext: ItemContext | null;
}

export interface Props extends HookProps {
  getItems: (itemContext: ItemContext) => Item[];
  onClick: (id: string, itemContext: ItemContext) => void;
}

export default function ContextMenu(
  { active, x, y, getItems, onClick, onClose, itemContext }: Props,
) {
  const ref = useClickAway<HTMLUListElement>(() => onClose());

  if (!active) return null;

  const items = getItems(itemContext);
  if (items.length === 0) return null;

  const WIDTH = 256;
  const HEIGHT = items.length * 24 + 20;
  const BUFFER = 10;

  // by default, show the context menu to the right; if the cursor is close
  // to the right side of the screen, switch to the left instead; do the
  // same thing with below (default) / above
  const hPosition = x! >= globalThis.window.innerWidth - WIDTH - BUFFER
    ? "left"
    : "right";
  const vPosition = y! >= globalThis.window.innerHeight - HEIGHT - BUFFER
    ? "above"
    : "below";

  const style: { top?: string; left?: string } = {};

  switch (hPosition) {
    case "left":
      style.left = `${x! - WIDTH - BUFFER}px`;
      break;

    case "right":
      style.left = `${x! + BUFFER}px`;
      break;

    default:
      throw new Error("unreachable");
  }

  switch (vPosition) {
    case "above":
      style.top = `${y! - HEIGHT + BUFFER}px`;
      break;

    case "below":
      style.top = `${y! - BUFFER}px`;
      break;

    default:
      throw new Error("unreachable");
  }

  const body = (
    <ul
      ref={ref}
      style={style}
      className="fixed z-50 w-64 text-xs bg-base-100 text-base-content
      py-2 rounded-sm overflow-hidden shadow-lg cursor-pointer"
    >
      {items.map((item, idx) =>
        item.id === "divider"
          ? <li key={idx} className="h-px my-1 bg-base-200" />
          : (
            <li
              key={item.id}
              className={`py-1 px-3 ${
                item.disabled
                  ? "text-gray-500 cursor-default"
                  : "hover:bg-primary hover:text-primary-content"
              }`}
              onClick={() => {
                if (item.disabled) return;
                onClick(item.id, itemContext);
                onClose();
              }}
            >
              {item.label}
            </li>
          )
      )}
    </ul>
  );

  return createPortal(body, globalThis.document.body);
}
