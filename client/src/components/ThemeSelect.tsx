import React from "react";
import { THEMES } from "../const.ts";

const ACTIVE_THEME = globalThis.localStorage.getItem("theme");

export default function ThemeSelect() {
  return (
    <div className="dropdown dropdown-end">
      <div tabIndex={0} role="button" className="btn m-1">
        Theme
        <svg
          width="12px"
          height="12px"
          className="inline-block h-2 w-2 fill-current opacity-60"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 2048 2048"
        >
          <path d="M1799 349l242 241-1017 1017L7 590l242-241 775 775 775-775z">
          </path>
        </svg>
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
                className="theme-controller btn btn-sm btn-block btn-ghost justify-start checked:bg-base-100"
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
