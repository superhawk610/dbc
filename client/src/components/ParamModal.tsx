import Modal, {
  closeModal,
  ModalActions,
  ModalControlProps,
} from "./Modal.tsx";
import Field from "./form/Field.tsx";
import { QueryParam } from "../models/query.ts";

export interface Props extends ModalControlProps {
  params: QueryParam[];
  onSubmit: (params: string[]) => void;
}

export default function ParamModal({ params, onSubmit, ...props }: Props) {
  function handleSubmit(ev: React.FormEvent, actions: ModalActions) {
    ev.preventDefault();
    const form = new FormData(ev.target as HTMLFormElement);
    const values: string[] = [];
    for (let i = 0; i < params.length; i++) {
      values.push(form.get(params[i].name) as string);
    }

    onSubmit(values);
    closeModal(actions)(ev as React.MouseEvent, false);
  }

  return (
    <Modal heading="Query Parameters" {...props}>
      {(actions) => (
        <Modal.Body>
          <form onSubmit={(ev) => handleSubmit(ev, actions)}>
            {params.map((param, idx) => (
              <Field
                key={idx}
                name={param.name}
                label={`${param.name} (${param.type})`}
                autoFocus={idx === 0}
              />
            ))}
            <Modal.Actions>
              <button type="submit" className="btn btn-primary">Submit</button>
              <button
                type="button"
                className="btn"
                onClick={closeModal(actions)}
              >
                Cancel
              </button>
            </Modal.Actions>
          </form>
        </Modal.Body>
      )}
    </Modal>
  );
}
