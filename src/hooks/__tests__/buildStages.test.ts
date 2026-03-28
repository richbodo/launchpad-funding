import { describe, it, expect } from 'vitest';
import { buildStages } from '../useSessionStages';

const makeStartup = (email: string, name: string | null, order: number) => ({
  email,
  display_name: name,
  presentation_order: order,
});

describe('buildStages', () => {
  it('empty startup list → [Intro, Outro] (2 stages)', () => {
    const stages = buildStages([]);
    expect(stages).toHaveLength(2);
    expect(stages[0].type).toBe('intro');
    expect(stages[1].type).toBe('outro');
  });

  it('1 startup → [Intro, Presentation, Q&A, Outro] (4 stages)', () => {
    const stages = buildStages([makeStartup('a@test.com', 'Alpha', 1)]);
    expect(stages).toHaveLength(4);
    expect(stages.map(s => s.type)).toEqual(['intro', 'presentation', 'qa', 'outro']);
  });

  it('3 startups → 8 stages (intro + 3×(pres+qa) + outro)', () => {
    const startups = [
      makeStartup('a@test.com', 'Alpha', 1),
      makeStartup('b@test.com', 'Beta', 2),
      makeStartup('c@test.com', 'Gamma', 3),
    ];
    const stages = buildStages(startups);
    expect(stages).toHaveLength(8);
    expect(stages.map(s => s.type)).toEqual([
      'intro',
      'presentation', 'qa',
      'presentation', 'qa',
      'presentation', 'qa',
      'outro',
    ]);
  });

  it('each presentation stage has correct startupIndex', () => {
    const startups = [
      makeStartup('a@test.com', 'Alpha', 1),
      makeStartup('b@test.com', 'Beta', 2),
    ];
    const stages = buildStages(startups);
    const presentations = stages.filter(s => s.type === 'presentation');
    expect(presentations[0].startupIndex).toBe(0);
    expect(presentations[1].startupIndex).toBe(1);
  });

  it('each Q&A stage has same startupIndex as preceding presentation', () => {
    const startups = [
      makeStartup('a@test.com', 'Alpha', 1),
      makeStartup('b@test.com', 'Beta', 2),
    ];
    const stages = buildStages(startups);
    for (let i = 0; i < stages.length; i++) {
      if (stages[i].type === 'qa') {
        expect(stages[i].startupIndex).toBe(stages[i - 1].startupIndex);
      }
    }
  });

  it('intro and outro have no startupIndex (undefined)', () => {
    const stages = buildStages([makeStartup('a@test.com', 'Alpha', 1)]);
    const intro = stages.find(s => s.type === 'intro')!;
    const outro = stages.find(s => s.type === 'outro')!;
    expect(intro.startupIndex).toBeUndefined();
    expect(outro.startupIndex).toBeUndefined();
  });

  it('stage labels include startup display_name', () => {
    const stages = buildStages([makeStartup('a@test.com', 'AlphaTech', 1)]);
    const pres = stages.find(s => s.type === 'presentation')!;
    const qa = stages.find(s => s.type === 'qa')!;
    expect(pres.label).toContain('AlphaTech');
    expect(qa.label).toContain('AlphaTech');
  });

  it('falls back to email when display_name is null', () => {
    const stages = buildStages([makeStartup('founder@startup.io', null, 1)]);
    const pres = stages.find(s => s.type === 'presentation')!;
    expect(pres.label).toContain('founder@startup.io');
  });

  it('durations: intro=300s, presentation=300s, qa=180s, outro=300s', () => {
    const stages = buildStages([makeStartup('a@test.com', 'Alpha', 1)]);
    const byType = (t: string) => stages.find(s => s.type === t)!;
    expect(byType('intro').durationSeconds).toBe(300);
    expect(byType('presentation').durationSeconds).toBe(300);
    expect(byType('qa').durationSeconds).toBe(180);
    expect(byType('outro').durationSeconds).toBe(300);
  });
});
