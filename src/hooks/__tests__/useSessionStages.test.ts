import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSessionStages } from '../useSessionStages';

const startups = [
  { email: 'a@test.com', display_name: 'Alpha', presentation_order: 1 },
  { email: 'b@test.com', display_name: 'Beta', presentation_order: 2 },
];

describe('useSessionStages', () => {
  it('starts at stage 0, paused', () => {
    const { result } = renderHook(() => useSessionStages(startups));
    expect(result.current.currentStageIndex).toBe(0);
    expect(result.current.isPaused).toBe(true);
  });

  it('next() advances currentStageIndex by 1', () => {
    const { result } = renderHook(() => useSessionStages(startups));
    act(() => result.current.next());
    expect(result.current.currentStageIndex).toBe(1);
  });

  it('prev() decrements currentStageIndex by 1', () => {
    const { result } = renderHook(() => useSessionStages(startups));
    act(() => result.current.goToStage(2));
    act(() => result.current.prev());
    expect(result.current.currentStageIndex).toBe(1);
  });

  it('next() is no-op at last stage', () => {
    const { result } = renderHook(() => useSessionStages(startups));
    const lastIndex = result.current.stages.length - 1;
    act(() => result.current.goToStage(lastIndex));
    act(() => result.current.next());
    expect(result.current.currentStageIndex).toBe(lastIndex);
  });

  it('prev() is no-op at stage 0', () => {
    const { result } = renderHook(() => useSessionStages(startups));
    act(() => result.current.prev());
    expect(result.current.currentStageIndex).toBe(0);
  });

  it('goToStage(n) jumps to stage n and resets remainingSeconds', () => {
    const { result } = renderHook(() => useSessionStages(startups));
    act(() => result.current.goToStage(3));
    expect(result.current.currentStageIndex).toBe(3);
    expect(result.current.remainingSeconds).toBe(result.current.stages[3].durationSeconds);
  });

  it('togglePause() flips isPaused', () => {
    const { result } = renderHook(() => useSessionStages(startups));
    expect(result.current.isPaused).toBe(true);
    act(() => result.current.togglePause());
    expect(result.current.isPaused).toBe(false);
    act(() => result.current.togglePause());
    expect(result.current.isPaused).toBe(true);
  });

  it('activeStartupIndex matches currentStage.startupIndex', () => {
    const { result } = renderHook(() => useSessionStages(startups));
    // Stage 1 is Alpha Presentation (startupIndex 0)
    act(() => result.current.goToStage(1));
    expect(result.current.activeStartupIndex).toBe(0);
    // Stage 3 is Beta Presentation (startupIndex 1)
    act(() => result.current.goToStage(3));
    expect(result.current.activeStartupIndex).toBe(1);
  });

  it('activeStartupIndex is undefined during intro/outro', () => {
    const { result } = renderHook(() => useSessionStages(startups));
    // Stage 0 is Intro
    expect(result.current.activeStartupIndex).toBeUndefined();
    // Last stage is Outro
    const lastIndex = result.current.stages.length - 1;
    act(() => result.current.goToStage(lastIndex));
    expect(result.current.activeStartupIndex).toBeUndefined();
  });

  it('next() resets remainingSeconds to new stage duration', () => {
    const { result } = renderHook(() => useSessionStages(startups));
    act(() => result.current.next());
    expect(result.current.remainingSeconds).toBe(
      result.current.stages[1].durationSeconds
    );
  });

  it('prev() resets remainingSeconds to new stage duration', () => {
    const { result } = renderHook(() => useSessionStages(startups));
    act(() => result.current.goToStage(2));
    act(() => result.current.prev());
    expect(result.current.remainingSeconds).toBe(
      result.current.stages[1].durationSeconds
    );
  });

  it('syncState() sets index, paused, and remaining', () => {
    const { result } = renderHook(() => useSessionStages(startups));
    act(() => result.current.syncState(2, false, 42));
    expect(result.current.currentStageIndex).toBe(2);
    expect(result.current.isPaused).toBe(false);
    expect(result.current.remainingSeconds).toBe(42);
  });
});

describe('useSessionStages — manual navigation pauses timer', () => {
  it('goToStage() pauses the timer', () => {
    const { result } = renderHook(() => useSessionStages(startups));
    // Unpause first
    act(() => result.current.togglePause());
    expect(result.current.isPaused).toBe(false);
    // Manual jump should pause
    act(() => result.current.goToStage(2));
    expect(result.current.isPaused).toBe(true);
  });

  it('next() pauses the timer', () => {
    const { result } = renderHook(() => useSessionStages(startups));
    act(() => result.current.togglePause());
    expect(result.current.isPaused).toBe(false);
    act(() => result.current.next());
    expect(result.current.isPaused).toBe(true);
  });

  it('prev() pauses the timer', () => {
    const { result } = renderHook(() => useSessionStages(startups));
    act(() => result.current.goToStage(2));
    act(() => result.current.togglePause());
    expect(result.current.isPaused).toBe(false);
    act(() => result.current.prev());
    expect(result.current.isPaused).toBe(true);
  });
});

describe('useSessionStages — auto-advance on timer expiry', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-advances to next stage when timer reaches zero', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSessionStages(startups));

    // Use syncState to set remaining to 1s and unpause
    act(() => result.current.syncState(0, false, 1));
    expect(result.current.currentStageIndex).toBe(0);

    // Tick 1 second — should auto-advance
    act(() => vi.advanceTimersByTime(1000));

    expect(result.current.currentStageIndex).toBe(1);
    expect(result.current.remainingSeconds).toBe(
      result.current.stages[1].durationSeconds
    );
  });

  it('auto-advance keeps timer running (not paused)', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSessionStages(startups));

    act(() => result.current.syncState(0, false, 1));
    act(() => vi.advanceTimersByTime(1000));

    // Timer should still be running after auto-advance
    expect(result.current.isPaused).toBe(false);
  });

  it('auto-advance at last stage pauses instead of overflowing', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSessionStages(startups));
    const lastIndex = result.current.stages.length - 1; // Outro

    act(() => result.current.syncState(lastIndex, false, 1));
    act(() => vi.advanceTimersByTime(1000));

    expect(result.current.currentStageIndex).toBe(lastIndex);
    expect(result.current.isPaused).toBe(true);
  });

  it('auto-advance counts down the new stage after transition', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSessionStages(startups));

    // Set to 1s remaining on stage 0, unpaused
    act(() => result.current.syncState(0, false, 1));
    // Advance past the expiry into stage 1
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.currentStageIndex).toBe(1);

    const stage1Duration = result.current.stages[1].durationSeconds;
    // Let 3 more seconds tick on the new stage
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.remainingSeconds).toBe(stage1Duration - 3);
  });
});
