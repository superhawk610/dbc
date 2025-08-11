import React, { useEffect, useState } from "react";
import { HiOutlineCog as SettingsIcon } from "react-icons/hi";
import Connection from "../models/connection.ts";
import Modal, {
  closeModal,
  ModalActions,
  ModalControlProps,
} from "./Modal.tsx";
import Fieldset from "./form/Fieldset.tsx";
import Field from "./form/Field.tsx";
import { get, put } from "../api.ts";

interface Config {
  connections: Connection[];
}

interface SettingsModalBodyProps {
  actions: ModalActions;
  onSave: (connections: Connection[]) => void;
}

function SettingsModalBody({ actions, onSave }: SettingsModalBodyProps) {
  const [config, setConfig] = useState<Config | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await get("/config");
      setConfig(res);
    })();
  }, []);

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();

    const formData = new FormData(ev.target as HTMLFormElement);
    const conn = Object.fromEntries(formData) as Record<
      string,
      string | number
    >;
    conn.port = Number(conn.port);
    const connections = [conn] as unknown as Connection[];
    const updatedConfig = { connections: [conn] } as unknown as Config;

    await put("/config", updatedConfig);
    setConfig(updatedConfig);
    onSave?.(connections);
    closeModal(actions)(ev as React.MouseEvent);
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={handleSubmit}
      onChange={() => setDirty(true)}
    >
      {!config ? <span className="loading loading-infinity loading-xl" /> : (
        config.connections.map((conn, idx) => (
          <Fieldset key={idx} heading="Connection details">
            <Field name="name" defaultValue={conn.name} />
            <Field name="host" defaultValue={conn.host} />
            <Field name="port" defaultValue={conn.port} type="number" />
            <Field name="username" defaultValue={conn.username} />
            <Field name="password" defaultValue={conn.password} />
            <Field name="database" defaultValue={conn.database} />
          </Fieldset>
        ))
      )}

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
  );
}

export interface Props extends ModalControlProps {
  onSave: (connections: Connection[]) => void;
}

export default function SettingsModal({ onSave, ...props }: Props) {
  return (
    <Modal
      {...props}
      heading="Settings ⚙"
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
