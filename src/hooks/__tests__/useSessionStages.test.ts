import { describe, it, expect } from 'vitest';
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
});
