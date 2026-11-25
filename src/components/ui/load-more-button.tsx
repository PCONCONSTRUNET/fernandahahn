import { ChevronDown } from "lucide-react";

interface LoadMoreButtonProps {
  visibleCount: number;
  totalCount: number;
  step?: number;
  onLoadMore: () => void;
  itemLabel?: string;
}

export function LoadMoreButton({
  visibleCount,
  totalCount,
  step = 15,
  onLoadMore,
  itemLabel = "itens",
}: LoadMoreButtonProps) {
  const remaining = Math.max(0, totalCount - visibleCount);
  if (remaining <= 0) return null;

  const nextBatch = Math.min(step, remaining);

  return (
    <div className="pt-1 flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={onLoadMore}
        className="w-full sm:w-auto sm:min-w-[240px] flex items-center justify-center gap-2 rounded-xl border border-gold/30 bg-gold/[0.08] px-4 py-2.5 font-body text-[12px] font-semibold text-gold hover:bg-gold/15 hover:border-gold/50 active:scale-[0.98] transition-all"
      >
        <ChevronDown className="w-3.5 h-3.5" />
        Ver mais {nextBatch} {itemLabel}
        <span className="text-gold/70 font-normal tabular-nums">
          ({remaining} restante{remaining === 1 ? "" : "s"})
        </span>
      </button>
      <p className="font-body text-[10.5px] text-primary-foreground/45 tabular-nums">
        Mostrando {Math.min(visibleCount, totalCount)} de {totalCount}
      </p>
    </div>
  );
}
