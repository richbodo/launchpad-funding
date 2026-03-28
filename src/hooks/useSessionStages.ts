import { useState, useEffect, useRef, useMemo, useCallback } from 'react';

export interface Stage {
  label: string;
  fullLabel: string;
  type: 'intro' | 'presentation' | 'qa' | 'outro';
  durationSeconds: number;
  startupIndex?: number;
}

interface Startup {
  email: string;
  display_name: string | null;
  presentation_order: number | null;
}

interface UseSessionStagesReturn {
  stages: Stage[];
  currentStage: Stage;
  currentStageIndex: number;
  isPaused: boolean;
  remainingSeconds: number;
  next: () => void;
  prev: () => void;
  goToStage: (index: number) => void;
  togglePause: () => void;
  activeStartupIndex: number | undefined;
}

export function buildStages(startups: Startup[]): Stage[] {
  const stages: Stage[] = [];

  stages.push({
    label: 'Introduction',
    fullLabel: 'Stage 1 — Introduction',
    type: 'intro',
    durationSeconds: 5 * 60,
  });

  startups.forEach((s, i) => {
    const name = s.display_name || s.email;
    const stageNum = stages.length + 1;
    stages.push({
      label: `${name} Presentation`,
      fullLabel: `Stage ${stageNum} — ${name} Presentation`,
      type: 'presentation',
      durationSeconds: 5 * 60,
      startupIndex: i,
    });
    const qaNum = stageNum + 1;
    stages.push({
      label: `${name} Q&A`,
      fullLabel: `Stage ${qaNum} — ${name} Q&A`,
      type: 'qa',
      durationSeconds: 3 * 60,
      startupIndex: i,
    });
  });

  stages.push({
    label: 'Outro',
    fullLabel: `Stage ${stages.length + 1} — Outro`,
    type: 'outro',
    durationSeconds: 5 * 60,
  });

  return stages;
}

export function useSessionStages(startups: Startup[]): UseSessionStagesReturn {
  const stages = useMemo(() => buildStages(startups), [startups]);

  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(stages[0]?.durationSeconds ?? 0);
  const [isPaused, setIsPaused] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset when stages change (e.g. startups loaded)
  useEffect(() => {
    setCurrentStageIndex(0);
    setRemainingSeconds(stages[0]?.durationSeconds ?? 0);
    setIsPaused(true);
  }, [stages]);

  // Countdown interval
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    if (!isPaused && remainingSeconds > 0) {
      intervalRef.current = setInterval(() => {
        setRemainingSeconds(prev => {
          if (prev <= 1) {
            // Auto-advance
            setCurrentStageIndex(ci => {
              const nextIndex = ci + 1;
              if (nextIndex < stages.length) {
                setRemainingSeconds(stages[nextIndex].durationSeconds);
                return nextIndex;
              }
              setIsPaused(true);
              return ci;
            });
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPaused, stages]);

  const goToStage = useCallback((index: number) => {
    if (index >= 0 && index < stages.length) {
      setCurrentStageIndex(index);
      setRemainingSeconds(stages[index].durationSeconds);
    }
  }, [stages]);

  const next = useCallback(() => {
    if (currentStageIndex < stages.length - 1) {
      goToStage(currentStageIndex + 1);
    }
  }, [currentStageIndex, stages.length, goToStage]);

  const prev = useCallback(() => {
    if (currentStageIndex > 0) {
      goToStage(currentStageIndex - 1);
    }
  }, [currentStageIndex, goToStage]);

  const togglePause = useCallback(() => {
    setIsPaused(p => !p);
  }, []);

  const currentStage = stages[currentStageIndex] ?? stages[0];
  const activeStartupIndex = currentStage?.startupIndex;

  return {
    stages,
    currentStage,
    currentStageIndex,
    isPaused,
    remainingSeconds,
    next,
    prev,
    goToStage,
    togglePause,
    activeStartupIndex,
  };
}
