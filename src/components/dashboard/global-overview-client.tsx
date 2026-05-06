"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import type { jsPDF as JsPDFType } from "jspdf";

import {
  GlobalAggregateCard,
  GlobalAppCard,
  type ExecutiveAppCard,
} from "@/components/dashboard/global-app-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatChartDate, formatCompactNumber, formatCredits, formatUsd } from "@/lib/format";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function rangeFromCards(cards: ExecutiveAppCard[]): { from: string; to: string } | null {
  const dates = cards.flatMap((card) => card.trend.map((point) => point.date)).sort();
  if (dates.length === 0) return null;
  return { from: dates[0]!, to: dates[dates.length - 1]! };
}

function usageValue(card: ExecutiveAppCard): string {
  if (card.usageLabel.toLowerCase().includes("credit")) return formatCredits(card.usageValue);
  return formatCompactNumber(card.usageValue);
}

function changeLabel(changePct: number | null): string {
  if (changePct === null) return "New vs prior period";
  const sign = changePct > 0 ? "+" : "";
  return `${sign}${changePct.toFixed(1)}% vs prior period`;
}

function aggregateChangePct(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? null : 0;
  return ((current - previous) / previous) * 100;
}

function aggregateTrend(cards: ExecutiveAppCard[]): { date: string; usd: number }[] {
  const sumByDate = new Map<string, number>();
  for (const card of cards) {
    for (const point of card.trend) {
      sumByDate.set(point.date, (sumByDate.get(point.date) ?? 0) + point.usd);
    }
  }
  return Array.from(sumByDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, usd]) => ({ date, usd }));
}

function buildAggregateCard(cards: ExecutiveAppCard[]): ExecutiveAppCard | null {
  if (cards.length === 0) return null;

  const totals = cards.reduce(
    (acc, card) => {
      acc.primaryUsd += card.primaryUsd;
      acc.previousPrimaryUsd += card.previousPrimaryUsd;
      acc.projectedUsd += card.projectedUsd;
      acc.tokens += card.tokens;
      acc.requests += card.requests;
      return acc;
    },
    { primaryUsd: 0, previousPrimaryUsd: 0, projectedUsd: 0, tokens: 0, requests: 0 },
  );

  const change = aggregateChangePct(totals.primaryUsd, totals.previousPrimaryUsd);
  const cpmt = totals.tokens > 0 && totals.primaryUsd > 0 ? totals.primaryUsd / (totals.tokens / 1_000_000) : null;
  const trend = aggregateTrend(cards);

  const changeText =
    change === null ? "" : ` (${change > 0 ? "+" : ""}${change.toFixed(1)}% vs prior)`;
  const recommendation = `Across ${cards.length} active app${cards.length === 1 ? "" : "s"}, ${formatUsd(totals.primaryUsd)} total spend${changeText}; projected to ${formatUsd(totals.projectedUsd)} for the period.`;

  return {
    source: cards[0]!.source,
    label: "All Apps",
    href: "",
    primaryUsd: totals.primaryUsd,
    primaryLabel: "Combined spend",
    usageLabel: "Tokens",
    usageValue: totals.tokens,
    tokens: totals.tokens,
    requests: totals.requests,
    costPerMillionTokens: cpmt,
    previousPrimaryUsd: totals.previousPrimaryUsd,
    changePct: change,
    projectedUsd: totals.projectedUsd,
    status: "healthy",
    statusLabel: "All Apps",
    recommendation,
    warnings: [],
    trend,
  };
}

type Rgb = readonly [number, number, number];

const PALETTE = {
  ink: [20, 24, 35] as Rgb,
  mute: [91, 103, 120] as Rgb,
  primary: [37, 99, 235] as Rgb,
  primarySoft: [219, 234, 254] as Rgb,
  surface: [255, 255, 255] as Rgb,
  surfaceMuted: [246, 248, 252] as Rgb,
  surfaceTonal: [232, 241, 255] as Rgb,
  border: [226, 232, 240] as Rgb,
} as const;

const SPARKLINE_GUTTER = 36;

function truncate(doc: JsPDFType, text: string, maxWidth: number): string {
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 1 && doc.getTextWidth(`${truncated}…`) > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}…`;
}

function compactUsd(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function drawPill(doc: JsPDFType, text: string, rightX: number, topY: number): { width: number; height: number } {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  const padding = 6;
  const height = 14;
  const width = doc.getTextWidth(text) + padding * 2;
  const x = rightX - width;
  doc.setFillColor(...PALETTE.primarySoft);
  doc.roundedRect(x, topY, width, height, 7, 7, "F");
  doc.setTextColor(...PALETTE.primary);
  doc.text(text, x + width / 2, topY + height / 2 + 2.6, { align: "center" });
  return { width, height };
}

function drawSparkline(
  doc: JsPDFType,
  trend: ExecutiveAppCard["trend"],
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const plotX = x + SPARKLINE_GUTTER;
  const plotW = width - SPARKLINE_GUTTER;
  const usableHeight = height - 8;
  const baselineY = y + height - 4;
  const topY = baselineY - usableHeight;

  doc.setDrawColor(...PALETTE.border);
  doc.setLineWidth(0.5);
  doc.line(plotX, topY, plotX, baselineY);
  doc.line(plotX, baselineY, plotX + plotW, baselineY);

  const max = trend.reduce((largest, point) => Math.max(largest, point.usd), 0);
  const tickValues = [0, max / 2, max];
  const tickYs = [baselineY, baselineY - usableHeight / 2, topY];

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...PALETTE.mute);
  for (let i = 0; i < tickValues.length; i += 1) {
    const tickY = tickYs[i]!;
    doc.setDrawColor(...PALETTE.border);
    doc.setLineWidth(0.5);
    doc.line(plotX - 2, tickY, plotX, tickY);
    doc.text(compactUsd(tickValues[i]!), plotX - 4, tickY + 2, { align: "right" });
  }

  if (trend.length < 2 || max <= 0) return;

  doc.setDrawColor(...PALETTE.primary);
  doc.setLineWidth(1.4);
  doc.setLineCap("round");
  doc.setLineJoin("round");

  let prevX = plotX;
  let prevY = baselineY - (trend[0]!.usd / max) * usableHeight;
  for (let i = 1; i < trend.length; i += 1) {
    const px = plotX + (i / (trend.length - 1)) * plotW;
    const py = baselineY - (trend[i]!.usd / max) * usableHeight;
    doc.line(prevX, prevY, px, py);
    prevX = px;
    prevY = py;
  }
}

function drawCard(
  doc: JsPDFType,
  card: ExecutiveAppCard,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  doc.setFillColor(...PALETTE.surface);
  doc.setDrawColor(...PALETTE.border);
  doc.setLineWidth(0.6);
  doc.roundedRect(x, y, width, height, 12, 12, "FD");

  const padding = 14;
  const innerX = x + padding;
  const innerWidth = width - padding * 2;
  let cy = y + padding;

  const pill = drawPill(doc, card.statusLabel, x + width - padding, cy);
  const titleMaxWidth = innerWidth - pill.width - 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...PALETTE.ink);
  doc.text(truncate(doc, card.label, titleMaxWidth), innerX, cy + 11);
  cy += 18;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...PALETTE.mute);
  const subtitle = card.periodLabel ? `${card.primaryLabel} · ${card.periodLabel}` : card.primaryLabel;
  doc.text(truncate(doc, subtitle, innerWidth), innerX, cy + 8);
  cy += 16;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(...PALETTE.ink);
  doc.text(formatUsd(card.primaryUsd), innerX, cy + 18);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...PALETTE.primary);
  doc.text(changeLabel(card.changePct), x + width - padding, cy + 18, { align: "right" });

  cy += 24;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...PALETTE.mute);
  doc.text(`Previous period: ${formatUsd(card.previousPrimaryUsd)}`, innerX, cy + 8);
  cy += 18;

  const metrics: [string, string][] = [
    [card.usageLabel, usageValue(card)],
    ["Forecast", formatUsd(card.projectedUsd)],
    ["$/1M tok", card.costPerMillionTokens === null ? "N/A" : formatUsd(card.costPerMillionTokens)],
  ];
  const metricGap = 6;
  const metricHeight = 38;
  const metricWidth = (innerWidth - metricGap * 2) / 3;
  for (let i = 0; i < metrics.length; i += 1) {
    const [label, value] = metrics[i]!;
    const mx = innerX + i * (metricWidth + metricGap);
    doc.setFillColor(...PALETTE.surfaceMuted);
    doc.roundedRect(mx, cy, metricWidth, metricHeight, 8, 8, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...PALETTE.mute);
    doc.text(truncate(doc, label.toUpperCase(), metricWidth - 14), mx + 8, cy + 12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...PALETTE.ink);
    doc.text(truncate(doc, value, metricWidth - 14), mx + 8, cy + 28);
  }
  cy += metricHeight + 12;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...PALETTE.mute);
  doc.text("DAILY SPEND/VALUE TREND", innerX, cy + 7);
  cy += 12;

  const sparklineHeight = 48;
  drawSparkline(doc, card.trend, innerX, cy, innerWidth, sparklineHeight);
  cy += sparklineHeight + 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...PALETTE.mute);
  if (card.trend[0]) {
    doc.text(formatChartDate(card.trend[0].date), innerX + SPARKLINE_GUTTER, cy + 7);
  }
  const last = card.trend.at(-1);
  if (last) {
    doc.text(formatChartDate(last.date), innerX + innerWidth, cy + 7, { align: "right" });
  }
  cy += 14;

  const recPadding = 8;
  const recLineHeight = 11;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const recLines = doc.splitTextToSize(card.recommendation, innerWidth - recPadding * 2) as string[];
  const remaining = y + height - cy - 4;
  const maxLines = Math.max(1, Math.floor((remaining - recPadding * 2) / recLineHeight));
  const visibleLines =
    recLines.length > maxLines ? [...recLines.slice(0, maxLines - 1), `${recLines[maxLines - 1]!.trimEnd()}…`] : recLines;
  const recHeight = Math.min(remaining, visibleLines.length * recLineHeight + recPadding * 2);

  doc.setFillColor(...PALETTE.surfaceTonal);
  doc.roundedRect(innerX, cy, innerWidth, recHeight, 8, 8, "F");
  doc.setTextColor(...PALETTE.ink);
  doc.text(visibleLines, innerX + recPadding, cy + recPadding + 8);
}

export function GlobalOverviewClient() {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();

  const [cards, setCards] = useState<ExecutiveAppCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const aggregate = useMemo(() => buildAggregateCard(cards), [cards]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/metrics/global-executive?${qs}`, { cache: "no-store" });
        const json = await res.json();

        if (!res.ok) throw new Error(json.error ?? "Failed to load global executive dashboard");

        if (!cancelled) {
          setCards((json.data ?? []) as ExecutiveAppCard[]);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [qs]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl bg-card p-6 shadow-sm">
        <h2 className="text-base font-semibold">Global Overview</h2>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  const withSearchParams = (href: string) => {
    const params = new URLSearchParams(searchParams.toString());
    const query = params.toString();
    return query ? `${href}?${query}` : href;
  };

  const selectedRange = {
    from: searchParams.get("from") ?? rangeFromCards(cards)?.from ?? "selected period",
    to: searchParams.get("to") ?? rangeFromCards(cards)?.to ?? "selected period",
  };
  const cycleMode = searchParams.get("datePreset") === "cycle";
  const selectedRangeLabel = cycleMode
    ? "Per-app billing cycles"
    : selectedRange.from === selectedRange.to
      ? selectedRange.from
      : `${selectedRange.from} to ${selectedRange.to}`;

  async function downloadPdf() {
    setExporting(true);
    setExportError(null);
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 36;
      const contentWidth = pageWidth - margin * 2;
      const cardGutter = 12;
      const cardWidth = (contentWidth - cardGutter) / 2;
      const cardHeight = 290;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(20);
      doc.setTextColor(...PALETTE.ink);
      doc.text("Global Executive Overview", margin, margin + 16);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(...PALETTE.mute);
      const subtitle = doc.splitTextToSize(
        "One-card summaries for active AI platforms, optimized for finance and leadership funding conversations.",
        contentWidth,
      ) as string[];
      const subtitleY = margin + 34;
      doc.text(subtitle, margin, subtitleY);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(...PALETTE.mute);
      const periodY = subtitleY + subtitle.length * 12 + 8;
      doc.text(`Selected period: ${selectedRangeLabel}`, margin, periodY);

      let rowY = periodY + 18;
      let col = 0;

      if (aggregate) {
        const aggregateHeight = 260;
        if (rowY + aggregateHeight > pageHeight - margin) {
          doc.addPage();
          rowY = margin;
        }
        drawCard(doc, aggregate, margin, rowY, contentWidth, aggregateHeight);
        rowY += aggregateHeight + cardGutter;
      }

      for (const card of cards) {
        if (rowY + cardHeight > pageHeight - margin) {
          doc.addPage();
          rowY = margin;
          col = 0;
        }
        const cardX = margin + col * (cardWidth + cardGutter);
        drawCard(doc, card, cardX, rowY, cardWidth, cardHeight);

        col += 1;
        if (col >= 2) {
          col = 0;
          rowY += cardHeight + cardGutter;
        }
      }

      doc.save(`Tokenomics - ${todayIso()}.pdf`);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-2xl bg-surface-tonal px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-3xl">
          <h1 className="text-lg font-semibold tracking-tight">Global Executive Overview</h1>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            One-card summaries for active AI platforms, optimized for finance and leadership funding conversations.
            Dollars lead, usage explains demand, and forecasts show where the period is headed.
          </p>
          <p className="mt-2 text-xs font-medium text-muted-foreground">Selected period: {selectedRangeLabel}</p>
          {exportError ? (
            <p className="mt-2 text-xs font-medium text-destructive">PDF export failed: {exportError}</p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={downloadPdf}
          disabled={cards.length === 0 || exporting}
        >
          <Download className="h-4 w-4" />
          {exporting ? "Preparing PDF..." : "Download PDF"}
        </Button>
      </div>

      {cards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/70 bg-card p-8 text-center">
          <h2 className="text-base font-semibold">No active app usage in this period</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Adjust the date range or sync source data to populate executive cards.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {aggregate ? <GlobalAggregateCard card={aggregate} sources={cards} /> : null}
          <div className="grid gap-4 xl:grid-cols-2">
            {cards.map((card) => (
              <GlobalAppCard key={card.source} card={card} href={withSearchParams(card.href)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
