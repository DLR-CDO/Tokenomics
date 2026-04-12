"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export type TrendData = {
  changePct: number;
  label?: string;
};

export function computeTrend(values: number[]): TrendData {
  const midpoint = Math.floor(values.length / 2);
  const firstHalf = values.slice(0, midpoint);
  const secondHalf = values.slice(midpoint);
  const avgFirst = firstHalf.length ? firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length : 0;
  const avgSecond = secondHalf.length ? secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length : 0;
  const changePct = avgFirst > 0 ? ((avgSecond - avgFirst) / avgFirst) * 100 : 0;
  return { changePct };
}

export function TrendBadge({ 
  changePct, 
  label, 
  className,
  size = "md"
}: { 
  changePct: number; 
  label?: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const TrendIcon = changePct > 2 ? TrendingUp : changePct < -2 ? TrendingDown : Minus;
  const color = changePct > 2
    ? "text-chart-5"
    : changePct < -2
      ? "text-chart-2"
      : "text-muted-foreground";

  return (
    <div className={cn(
      "flex items-center gap-1 rounded-full bg-background/60 font-medium",
      size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
      color,
      className
    )}>
      <TrendIcon className={size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3"} />
      <span>
        {Math.abs(changePct).toFixed(1)}%
        {label && <span className="ml-1 opacity-70">{label}</span>}
      </span>
    </div>
  );
}
