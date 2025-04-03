import ThemeSelect from "./ThemeSelect.tsx";

export default function Navbar() {
  return (
    <div className="navbar">
      <div className="flex-1">
        <a href="/" className="btn btn-ghost text-xl">
          dbc (Database Client)
        </a>
      </div>
      <div className="flex-none">
        <ThemeSelect />
      </div>
    </div>
  );
}
