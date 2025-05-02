import React from "react";

export interface Props {
  heading: string;
  children?: React.ReactNode;
}

export default function Fieldset({ heading, children }: Props) {
  return (
    <fieldset className="fieldset gap-4 bg-base-200 border-base-300 rounded-box border p-4">
      <legend className="fieldset-legend">{heading}</legend>
      {children}
    </fieldset>
  );
}
