import ThemeSelect from "./ThemeSelect.tsx";
import SettingsModal from "./SettingsModal.tsx";

export default function Navbar() {
  return (
    <div className="navbar">
      <div className="flex-1">
        <a href="/" className="btn btn-ghost text-xl">
          dbc
          <span className="pl-2 pt-1 text-xs text-gray-500">
            database client
          </span>
        </a>
      </div>
      <div className="flex-none gap-2">
        <SettingsModal />
        <ThemeSelect />
      </div>
    </div>
  );
}
