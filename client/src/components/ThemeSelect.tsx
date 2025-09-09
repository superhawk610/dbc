import React from "react";
import { HiChevronDown as DropdownIcon } from "react-icons/hi";
import { THEMES } from "../const.ts";

const ACTIVE_THEME = globalThis.localStorage.getItem("theme");

// if enabled, make sure to remove the init script in `index.html`
const ENABLE_CONTROLLER = false;

export interface Props {
  className?: string;
  buttonClassName?: string;
  dropdownPosition?: "left" | "right";
}

export default function ThemeSelect(
  { className, buttonClassName, dropdownPosition = "left" }: Props,
) {
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
            defaultChecked={!ACTIVE_THEME}
            onChange={() => {
              if (!ENABLE_CONTROLLER) {
                delete document.documentElement.dataset.theme;
              }

              globalThis.localStorage.removeItem("theme");
            }}
          />
        </li>

        {THEMES.map((theme) => (
          <React.Fragment key={theme}>
            <li>
              <input
                type="radio"
                name="theme-dropdown"
                className="theme-controller btn btn-sm btn-block btn-ghost justify-start checked:bg-base-100 checked:text-base-content"
                aria-label={theme === "cmyk"
                  ? "CMYK"
                  : theme.charAt(0).toUpperCase() + theme.slice(1)}
                defaultValue={theme}
                defaultChecked={theme === ACTIVE_THEME}
                onChange={() => {
                  if (!ENABLE_CONTROLLER) {
                    document.documentElement.dataset.theme = theme;
                  }

                  globalThis.localStorage.setItem("theme", theme);
                }}
              />
            </li>
            {theme === "dark" && (
              <li className="border-b border-base-content/10 my-0" />
            )}
          </React.Fragment>
        ))}
      </ul>
    </div>
  );
}
