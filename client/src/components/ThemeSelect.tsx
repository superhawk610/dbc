import { Fragment, useEffect, useState } from "react";
import { HiChevronDown as DropdownIcon } from "react-icons/hi";
import { THEMES } from "../const.ts";

const ENABLE_CONTROLLER = false;

export function initializeTheme() {
  const theme = globalThis.localStorage.getItem("theme");
  if (theme) document.documentElement.dataset.theme = theme;
}

export interface Props {
  className?: string;
  buttonClassName?: string;
  dropdownPosition?: "left" | "right";
}

export default function ThemeSelect(
  { className, buttonClassName, dropdownPosition = "left" }: Props,
) {
  const [theme, setTheme] = useState<string | null>(
    globalThis.localStorage.getItem("theme"),
  );

  useEffect(() => {
    if (theme) {
      if (!ENABLE_CONTROLLER) {
        document.documentElement.dataset.theme = theme;
      }
      globalThis.localStorage.setItem("theme", theme);
    } else {
      if (!ENABLE_CONTROLLER) {
        delete document.documentElement.dataset.theme;
      }
      globalThis.localStorage.removeItem("theme");
    }
  }, [theme]);

  return (
    <div
      className={`dropdown ${
        dropdownPosition === "left" ? "dropdown-end" : "dropdown-start"
      } ${className}`}
    >
      <div
        tabIndex={0}
        role="button"
        className={`btn btn-sm space-x-2 ${buttonClassName}`}
      >
        Theme
        <DropdownIcon />
      </div>
      <ul
        tabIndex={0}
        className="dropdown-content mt-1 bg-base-300 rounded-box z-1 w-52 p-2 shadow-2xl max-h-[300px] overflow-y-auto"
      >
        <li>
          <input
            type="radio"
            name="theme-dropdown"
            className={`${
              ENABLE_CONTROLLER ? "theme-controller" : ""
            } btn btn-sm btn-block btn-ghost justify-start checked:bg-base-100`}
            aria-label="Default (system)"
            defaultValue=""
            checked={!theme}
            onChange={() => setTheme(null)}
          />
        </li>

        {THEMES.map((t) => (
          <Fragment key={t}>
            <li>
              <input
                type="radio"
                name="theme-dropdown"
                className={`${
                  ENABLE_CONTROLLER ? "theme-controller" : ""
                } btn btn-sm btn-block btn-ghost justify-start checked:bg-base-100 checked:text-base-content`}
                aria-label={t === "cmyk"
                  ? "CMYK"
                  : t.charAt(0).toUpperCase() + t.slice(1)}
                defaultValue={t}
                checked={t === theme}
                onChange={() => setTheme(t)}
              />
            </li>
            {t === "dark" && (
              <li className="border-b border-base-content/10 my-0" />
            )}
          </Fragment>
        ))}
      </ul>
    </div>
  );
}
