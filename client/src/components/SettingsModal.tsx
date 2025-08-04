import React, { useEffect, useState } from "react";
import Connection from "../models/connection.ts";
import Modal, { closeModal } from "./Modal.tsx";
import Fieldset from "./form/Fieldset.tsx";
import Field from "./form/Field.tsx";
import { get, put } from "../api.ts";

interface Config {
  connections: Connection[];
}

export default function SettingsModal() {
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
    await put("/config", { connections: [conn] });
  }

  return (
    <Modal
      heading="Settings ⚙"
      buttonText="Settings"
    >
      <Modal.Body className="pt-4">
        <form
          className="flex flex-col gap-4"
          onSubmit={handleSubmit}
          onChange={() => setDirty(true)}
        >
          {!config
            ? <span className="loading loading-infinity loading-xl" />
            : (
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
            <button disabled={!dirty} type="submit" className="btn btn-primary">
              Save
            </button>
            <button type="button" className="btn" onClick={closeModal}>
              Close
            </button>
          </Modal.Actions>
        </form>
      </Modal.Body>
    </Modal>
  );
}
