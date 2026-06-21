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
  /** Reset the current stage's timer back to its full duration (and pause). */
  resetStage: () => void;
  syncState: (index: number, paused: boolean, remaining: number) => void;
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
      // Bumped from 3 → 5 min per issue #39 (trial-run feedback).
      durationSeconds: 5 * 60,
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

  // Refs let the interval callback advance stages atomically without nesting
  // setState calls inside another updater (which was fragile under React 18
  // StrictMode and produced the "cycling through all stages at 0:00" bug
  // reported in issue #34).
  const stagesRef = useRef(stages);
  const indexRef = useRef(currentStageIndex);
  useEffect(() => { stagesRef.current = stages; }, [stages]);
  useEffect(() => { indexRef.current = currentStageIndex; }, [currentStageIndex]);

  // Countdown interval — depends only on `isPaused` so it doesn't tear down
  // and rebuild every tick; reads latest stages/index via refs.
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (isPaused) return;

    intervalRef.current = setInterval(() => {
      setRemainingSeconds(prev => {
        if (prev > 1) return prev - 1;
        // Hit zero — advance exactly one stage, or stop at the final one.
        const nextIndex = indexRef.current + 1;
        if (nextIndex < stagesRef.current.length) {
          setCurrentStageIndex(nextIndex);
          return stagesRef.current[nextIndex].durationSeconds;
        }
        // Final stage — stop cleanly, no cycling.
        setIsPaused(true);
        return 0;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPaused]);

  const goToStage = useCallback((index: number) => {
    if (index >= 0 && index < stages.length) {
      setCurrentStageIndex(index);
      setRemainingSeconds(stages[index].durationSeconds);
      setIsPaused(true);
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

  const resetStage = useCallback(() => {
    const dur = stages[currentStageIndex]?.durationSeconds ?? 0;
    setRemainingSeconds(dur);
    setIsPaused(true);
  }, [stages, currentStageIndex]);

  const syncState = useCallback((index: number, paused: boolean, remaining: number) => {
    setCurrentStageIndex(index);
    setRemainingSeconds(remaining);
    setIsPaused(paused);
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
    resetStage,
    syncState,
    activeStartupIndex,
  };
}
