import { useEffect, useRef, useState } from "react";
import { HiOutlineChip as ServerIcon } from "react-icons/hi";
import Modal, { closeModal, ModalActions } from "./Modal.tsx";
import { createSocket } from "../api.ts";

interface Props {
  actions: ModalActions;
}

function StreamModalBody({ actions }: Props) {
  const socketRef = useRef<WebSocket>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [output, setOutput] = useState("");

  useEffect(() => {
    if (!socketRef.current) {
      const socket = createSocket("blah");

      socket.onmessage = ({ data }) => setOutput((o) => o + data + "\n");
      socket.onerror = (err) => console.error(err);
      // socket.onopen = () => socket.send("hello");

      socketRef.current = socket;
    }
  }, []);

  // useLayoutEffect(() => {
  //   // TODO: stop auto-scrolling if user scrolls up, restore when they scroll back to bottom
  //   scrollRef.current!.scrollTop = scrollRef.current!.scrollHeight;
  // }, [output]);

  return (
    <Modal.Body>
      <div
        ref={scrollRef}
        className="h-72 text-sm overflow-auto bg-neutral/80 rounded-md"
      >
        <pre className="m-4 inline-block text-neutral-content font-mono">{output}</pre>
      </div>
      <Modal.Actions className="mt-2">
        <button
          type="button"
          className="btn"
          onClick={closeModal({
            close: () => {
              socketRef.current?.close();
              actions.close();
            },
          })}
        >
          Close
        </button>
      </Modal.Actions>
    </Modal.Body>
  );
}

export default function StreamModal() {
  return (
    <Modal
      size="medium"
      heading="Server Logs"
      buttonText={
        <>
          <ServerIcon /> Logs
        </>
      }
    >
      {(actions) => <StreamModalBody actions={actions} />}
    </Modal>
  );
}
