import { Badge } from "@/components/ui/badge";

export function Provenance({ source }: { source: "cursor" | "openai" | "azure" }) {
  const label =
    source === "cursor" ? "Cursor-reported" : source === "openai" ? "OpenAI-reported (planned)" : "Azure-reported (planned)";
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <Badge variant="secondary">{label}</Badge>
      <span>Figures reflect ingested API data. Compare vendors before treating totals as a single ledger.</span>
    </div>
  );
}
