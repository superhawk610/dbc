import { useEffect, useState } from "react";
import { get } from "../api.ts";

export default function useConnectionVersion(connection: string | null) {
  const [connectionInfo, setConnectionInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!connection) return;

    (async () => {
      const { info } = await get<{ info: string }>(
        `/connections/${connection}`,
      );
      const [name, version] = info.split(" ", 3);
      setConnectionInfo(`${name} ${version}`);
    })();
  }, [connection]);

  return connectionInfo;
}
