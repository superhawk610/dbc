import React from "react";
import { HiChevronDown as DropdownIcon } from "react-icons/hi";
import { THEMES } from "../const.ts";

const ACTIVE_THEME = globalThis.localStorage.getItem("theme");

export default function ThemeSelect() {
  return (
    <div className="dropdown dropdown-end">
      <div tabIndex={0} role="button" className="btn btn-sm space-x-2">
        Theme
        <DropdownIcon />
      </div>
      <ul
        tabIndex={0}
        className="dropdown-content bg-base-300 rounded-box z-1 w-52 p-2 shadow-2xl max-h-[300px] overflow-y-auto"
      >
        <li>
          <input
            type="radio"
            name="theme-dropdown"
            className="theme-controller btn btn-sm btn-block btn-ghost justify-start checked:bg-base-100"
            aria-label="Default (system)"
            defaultValue=""
            defaultChecked={!ACTIVE_THEME}
            onChange={() => {
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
