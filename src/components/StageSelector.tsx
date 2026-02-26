import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ListOrdered, ChevronRight } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Stage } from '@/hooks/useSessionStages';
import { cn } from '@/lib/utils';

interface StageSelectorProps {
  stages: Stage[];
  currentStageIndex: number;
  onSelectStage: (index: number) => void;
}

const DURATION_LABELS: Record<string, string> = {
  intro: '5 min',
  presentation: '5 min',
  qa: '3 min',
  outro: '5 min',
};

export default function StageSelector({ stages, currentStageIndex, onSelectStage }: StageSelectorProps) {
  const [open, setOpen] = useState(false);

  const handleSelect = (index: number) => {
    onSelectStage(index);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ListOrdered className="w-4 h-4 mr-1" />
          Select Stage
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Jump to Stage</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          <div className="flex flex-col gap-1 pr-2">
            {stages.map((stage, i) => {
              const isCurrent = i === currentStageIndex;
              return (
                <button
                  key={i}
                  onClick={() => handleSelect(i)}
                  className={cn(
                    'flex items-center justify-between w-full rounded-md px-3 py-2.5 text-left text-sm transition-colors',
                    isCurrent
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted'
                  )}
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{stage.fullLabel}</span>
                    <span className={cn(
                      'text-xs',
                      isCurrent ? 'text-primary-foreground/70' : 'text-muted-foreground'
                    )}>
                      {DURATION_LABELS[stage.type]} · {stage.type === 'intro' || stage.type === 'outro' ? 'Facilitator' : stage.type === 'presentation' ? 'Pitch' : 'Q&A'}
                    </span>
                  </div>
                  {!isCurrent && (
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
