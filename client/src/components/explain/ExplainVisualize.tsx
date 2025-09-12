export interface Props {
  plan: string;
  query: string;
}

// embed in an iframe to avoid bootstrap/tailwind style pollution
export default function ExplainVisualize({ plan, query }: Props) {
  return (
    <iframe
      className="h-full"
      src={`/explain.html?plan=${encodeURIComponent(plan)}&query=${
        encodeURIComponent(query)
      }`}
    />
  );
}
