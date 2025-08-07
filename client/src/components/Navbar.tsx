import { HiOutlineDatabase as DatabaseIcon } from "react-icons/hi";
import ThemeSelect from "./ThemeSelect.tsx";
import SettingsModal from "./SettingsModal.tsx";
import StreamModal from "./StreamModal.tsx";

export interface Props {
  children?: React.ReactNode;
}

export default function Navbar({ children }: Props) {
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
        <StreamModal />
        <SettingsModal />
        <ThemeSelect />
      </div>
    </div>
  );
}
