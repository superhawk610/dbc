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
import Connection from "../models/connection.ts";

interface SettingsModalBodyProps {
  actions: ModalActions;
  onSave: (connections: Connection[]) => void;
}

function SettingsModalBody({ actions, onSave }: SettingsModalBodyProps) {
  const [config, setConfig] = useState<Config | null>(null);
  const [connectionIndex, setConnectionIndex] = useState<number>(-1);
  const [dirty, setDirty] = useState(false);

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
      host: form.get("host") as string || "localhost",
      port: Number(form.get("port") || "5432"),
      username: form.get("username") as string,
      password: form.get("password") as string,
      database: form.get("database") as string || "postgres",
      // FIXME: allow selecting
      ssl: false,
    };

    if (!conn.name || !conn.username || !conn.password) {
      alert("Name, username, and password are required.");
      return;
    }

    // update config
    const connections = config!.connections.slice();
    if (connectionIndex > -1) {
      connections[connectionIndex] = conn;
    } else {
      connections.push(conn);
    }
    const updatedConfig = { ...config, connections };

    // dispatch to server
    await put("/config", updatedConfig);
    setConfig(updatedConfig);
    onSave?.(connections);
    closeModal(actions)(ev as React.MouseEvent);
  }

  if (!config) return <span className="loading loading-infinity loading-xl" />;

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
                ${connection?.name === conn.name ? "bg-primary" : ""}`}
              >
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
        <Fieldset heading="Connection details">
          <Field name="name" defaultValue={connection?.name} />
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
            name="database"
            defaultValue={connection?.database}
            label="Database (default: postgres)"
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
