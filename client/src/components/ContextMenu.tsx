import { useState } from "react";
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
  id: string;
  label: string;
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

  return (
    <ul
      ref={ref}
      className="fixed z-50 w-64 text-sm bg-base-100 text-base-content rounded-sm overflow-hidden shadow-lg cursor-pointer"
      style={{ top: `${y! - 10}px`, left: `${x! + 10}px` }}
    >
      {items.map((item) => (
        <li
          key={item.id}
          className="py-1 px-3 hover:bg-primary hover:text-primary-content"
          onClick={() => {
            onClick(item.id, itemContext);
            onClose();
          }}
        >
          {item.label}
        </li>
      ))}
    </ul>
  );
}
