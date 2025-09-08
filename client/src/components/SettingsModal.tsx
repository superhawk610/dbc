import React, { useEffect, useState } from "react";
import { HiOutlineCog as SettingsIcon } from "react-icons/hi";
import Modal, {
  closeModal,
  ModalActions,
  ModalControlProps,
} from "./Modal.tsx";
import Fieldset from "./form/Fieldset.tsx";
import Field from "./form/Field.tsx";
import { get, put } from "../api.ts";
import Config from "../models/config.ts";
import Connection, {
  connectionColorToClass,
  loadConnectionColors,
  saveConnectionColors,
} from "../models/connection.ts";
import ColorRadio from "./form/ColorRadio.tsx";
import deepEqual from "deep-equal";

interface SettingsModalBodyProps {
  actions: ModalActions;
  onSave: (connections: Connection[]) => void;
}

function SettingsModalBody({ actions, onSave }: SettingsModalBodyProps) {
  const [config, setConfig] = useState<Config | null>(null);
  const [connectionIndex, setConnectionIndex] = useState<number>(-1);
  const [dirty, setDirty] = useState(false);

  if (config) {
    const colors = loadConnectionColors();
    config.connections.forEach((conn) => {
      conn.color = colors[conn.name];
    });
  }

  const connection = connectionIndex > -1
    ? config?.connections[connectionIndex]
    : null;

  useEffect(() => {
    (async () => {
      const config = await get<Config>("/config");
      setConfig(config);

      // select the first available connection by default
      if (config.connections.length > 0) setConnectionIndex(0);
    })();
  }, []);

  function changeConnection(idx: number) {
    if (!dirty || confirm("Are you sure? Any unsaved changes will be lost.")) {
      setDirty(false);
      setConnectionIndex(idx);
    }
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();

    // parse connection from form data
    const form = new FormData(ev.target as HTMLFormElement);
    const conn: Connection = {
      name: form.get("name") as string,
      color: form.get("color") as Connection["color"],
      host: form.get("host") as string || "localhost",
      port: Number(form.get("port") || "5432"),
      username: form.get("username") as string,
      password: form.get("password") as string || null,
      password_file: form.get("password_file") as string || null,
      database: form.get("database") as string || "postgres",
      ssl: form.get("ssl") === "on",
    };

    if (
      !conn.name ||
      !conn.username ||
      (!conn.password && !conn.password_file)
    ) {
      alert("Name, username, and password/password file are required.");
      return;
    }

    // update config
    let needsServerUpdate = true;
    const connections = config!.connections.slice();
    if (connectionIndex > -1) {
      // if nothing changed, don't update the server
      const newConn = { ...conn, color: null };
      const oldConn = { ...connections[connectionIndex], color: null };
      if (deepEqual(newConn, oldConn)) {
        needsServerUpdate = false;
      }

      connections[connectionIndex] = conn;
    } else {
      connections.push(conn);
    }

    const uniqueNames = connections.map((c) => c.name);
    if (uniqueNames.length !== new Set(uniqueNames).size) {
      alert("Connection names must be unique.");
      return;
    }

    const updatedConfig = { ...config as Config, connections };

    // dispatch to server
    if (needsServerUpdate) {
      await put("/config", updatedConfig);
    }

    // update colors
    const colors = loadConnectionColors();
    colors[conn.name] = conn.color;
    saveConnectionColors(colors);

    setConfig(updatedConfig);
    onSave?.(connections);
    closeModal(actions)(ev as React.MouseEvent);
  }

  if (!config) return <span className="loading loading-infinity loading-xl" />;

  const status = config!.status.find((s) => s.connection === connection?.name);

  return (
    <div className="flex w-full">
      <div className="mr-4 p-2 w-48 bg-neutral/30 rounded-md">
        <ul className="text-sm py-1 space-y-1">
          {config.connections.map((conn, idx) => (
            <li key={idx}>
              <button
                type="button"
                onClick={() => changeConnection(idx)}
                className={`px-2 py-0.5 w-full rounded text-left cursor-pointer
                hover:bg-primary/90 hover:text-primary-content
                ${
                  connection?.name === conn.name
                    ? "bg-primary text-primary-content"
                    : ""
                }`}
              >
                {conn.color && (
                  <span
                    className={`w-2 h-2 rounded-full inline-block mr-2 ${
                      connectionColorToClass(
                        conn.color,
                      )
                    }`}
                  />
                )}
                {conn.name}
              </button>
            </li>
          ))}

          <li>
            <div className="divider m-0" />
          </li>

          <li>
            <button
              type="button"
              onClick={() => changeConnection(-1)}
              className={`px-2 py-0.5 w-full rounded text-left cursor-pointer
                hover:bg-primary/90 hover:text-primary-content
                ${connection ? "" : "bg-primary"}`}
            >
              Add New...
            </button>
          </li>
        </ul>
      </div>

      <form
        key={connection?.name}
        className="flex-1 flex flex-col gap-4"
        onSubmit={handleSubmit}
        onChange={() => setDirty(true)}
      >
        <Fieldset heading="Status">
          <div className="-mt-2 flex flex-col gap-2">
            {!status
              ? (
                <span className="badge badge-xs badge-neutral">
                  Not connected
                </span>
              )
              : status.status === "pending"
              ? (
                <span className="badge badge-xs badge-neutral">
                  Connecting...
                </span>
              )
              : status.status === "active"
              ? (
                <>
                  <span className="badge badge-xs badge-success">
                    Connected
                  </span>
                  <code className="text-xs">{status.message}</code>
                </>
              )
              : (
                <>
                  <div className="badge badge-xs badge-warning">Error</div>
                  <code className="text-xs">{status.message}</code>
                </>
              )}
          </div>
        </Fieldset>
        <Fieldset heading="Connection details">
          <Field name="name" defaultValue={connection?.name} />
          <div className="-mt-1 mb-8">
            <ColorRadio name="color" label="Color" color={connection?.color} />
          </div>
          <Field
            name="host"
            defaultValue={connection?.host}
            label="Host (default: localhost)"
          />
          <Field
            name="port"
            defaultValue={connection?.port}
            type="number"
            label="Port (default: 5432)"
          />
          <Field name="username" defaultValue={connection?.username} />
          <Field name="password" defaultValue={connection?.password} />
          <Field
            name="password_file"
            label="Password File"
            defaultValue={connection?.password_file}
          />
          <Field
            name="database"
            defaultValue={connection?.database}
            label="Database (default: postgres)"
          />
          <Field
            type="checkbox"
            name="ssl"
            defaultChecked={connection?.ssl}
            label="Use SSL"
          />
        </Fieldset>

        <Modal.Actions className="mt-2">
          <button
            disabled={!dirty}
            type="submit"
            className="btn btn-primary"
          >
            Save
          </button>
          <button
            type="button"
            className="btn"
            onClick={closeModal(actions)}
          >
            Close
          </button>
        </Modal.Actions>
      </form>
    </div>
  );
}

export interface Props extends ModalControlProps {
  onSave: (connections: Connection[]) => void;
}

export default function SettingsModal({ onSave, ...props }: Props) {
  return (
    <Modal
      {...props}
      size="large"
      heading="Connection Settings"
      buttonText={
        <>
          <SettingsIcon /> Settings
        </>
      }
    >
      {(actions) => (
        <Modal.Body>
          <SettingsModalBody actions={actions} onSave={onSave} />
        </Modal.Body>
      )}
    </Modal>
  );
}
