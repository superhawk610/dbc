import { ReactNode, useEffect, useState } from "react";
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
  id: string | "divider" | "loading-indicator" | "scroller";
  disabled?: boolean;

  // required for standard items
  label?: string;

  // required for scroller items
  maxHeight?: number;
  maxHeightClass?: string;
  rows?: ReactNode[];
}

export interface HookProps {
  active: boolean;
  onClose: () => void;
  x: number | undefined;
  y: number | undefined;
  itemContext: ItemContext | null;
}

export interface Props extends HookProps {
  width?: number;
  widthClass?: string;
  getItems: (itemContext: ItemContext) => Item[];
  // Do any additional work needed to display additional information
  // about the items, e.g. fetching row counts. A loading indicator will
  // be displayed while this is in-progress, and the abort signal will
  // be sent when `active` is set to `false`.
  getItemsExtended?: (
    itemContext: ItemContext,
    items: Item[],
  ) => Promise<Item[]>;
  onClick: (id: string, itemContext: ItemContext) => void;
}

export default function ContextMenu(
  {
    active,
    x,
    y,
    width = 256,
    widthClass = "w-[256px]",
    getItems,
    getItemsExtended,
    onClick,
    onClose,
    itemContext,
  }: Props,
) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Item[]>([]);

  const ref = useClickAway<HTMLUListElement>(() => onClose());

  useEffect(() => {
    if (!itemContext) return;

    const items = getItems(itemContext);
    setItems(items);

    if (getItemsExtended) {
      (async () => {
        try {
          setLoading(true);
          const extendedItems = await getItemsExtended(itemContext, items);
          setItems(extendedItems);
        } finally {
          setLoading(false);
        }
      })();
    }
  }, [itemContext]);

  if (!active || items.length === 0) return null;

  const HEIGHT =
    items.map((item) =>
      item.id === "divider"
        ? 9
        : item.id === "scroller"
        ? (Math.min(item.rows!.length * 24, item.maxHeight!) + 8)
        : item.id === "loading-indicator"
        ? (loading ? 24 : 0)
        : 24
    ).reduce((a, b) => a + b) + 16;
  const BUFFER = 10;

  // by default, show the context menu to the right; if the cursor is close
  // to the right side of the screen, switch to the left instead; do the
  // same thing with below (default) / above
  const hPosition = x! >= globalThis.window.innerWidth - width - BUFFER
    ? "left"
    : "right";
  const vPosition = y! >= globalThis.window.innerHeight - HEIGHT - BUFFER
    ? "above"
    : "below";

  const style: { top?: string; left?: string } = {};

  switch (hPosition) {
    case "left":
      style.left = `${x! - width - BUFFER}px`;
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
      className={`fixed z-50 ${widthClass} text-xs bg-base-100 text-base-content
      py-2 rounded-sm overflow-hidden shadow-lg cursor-pointer`}
    >
      {items.map((item, idx) =>
        item.id === "divider"
          ? <li key={idx} className="h-px my-1 bg-base-200" />
          : item.id === "loading-indicator"
          ? (loading
            ? (
              <li key={idx} className="flex px-3 py-1 opacity-50">
                <div className="loading loading-infinity loading-xs" />
              </li>
            )
            : null)
          : item.id === "scroller"
          ? (
            <li
              key={idx}
              className={`-mx-3 py-1 px-3 ${
                item.disabled ? "opacity-50 cursor-default" : ""
              }`}
            >
              <ul
                className={`${item.maxHeightClass} overflow-y-auto overflow-hidden`}
              >
                {item.rows!.map((row, idx) => (
                  <li key={idx} className="py-1 px-3 truncate">
                    {row}
                  </li>
                ))}
              </ul>
            </li>
          )
          : (
            <li
              key={item.id}
              className={`py-1 px-3 ${
                item.disabled
                  ? "opacity-50 cursor-default"
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
