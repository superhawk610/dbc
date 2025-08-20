import { HiOutlineDatabase as DatabaseIcon } from "react-icons/hi";
import ThemeSelect from "./ThemeSelect.tsx";
import SettingsModal from "./SettingsModal.tsx";
import StreamModal from "./StreamModal.tsx";
import Connection from "../models/connection.ts";

export interface Props {
  onSaveSettings: (connections: Connection[]) => void;
  children?: React.ReactNode;
}

export default function Navbar({ onSaveSettings, children }: Props) {
  return (
    <div className="flex items-center px-4 py-2">
      <div className="flex-1">
        <a href="/" className="btn btn-ghost text-xl">
          <DatabaseIcon /> dbc
          <span className="pl-2 pt-1 text-xs text-base-content-300/60">
            database client
          </span>
        </a>
      </div>
      <div className="flex-none space-x-2">
        {children}
        {/* {(import.meta.env.VITE_SHOW_LOGS || !import.meta.env.PROD) && ( */}
        <StreamModal />
        {/* )} */}
        <SettingsModal onSave={onSaveSettings} />
        <ThemeSelect />
      </div>
    </div>
  );
}
