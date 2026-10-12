import { describe, expect, it } from 'vitest';
import { missingVars, render } from './templates';

describe('render', () => {
  const ctx = { team: { name: 'Coral Lemma', code: '05' }, division: 'online', members: [{ id: '05A', name: 'Hannah' }, { id: '05B', name: 'Mateo' }], award: '' };
  it('fills variables, loops and conditions', () => {
    expect(render('Team {{team.code}}: {{team.name}}', ctx)).toBe('Team 05: Coral Lemma');
    expect(render('{{#each members}}[{{id}} {{name}}]{{/each}}', ctx)).toBe('[05A Hannah][05B Mateo]');
    expect(render('{{#if division == "online"}}Zoom{{/if}}{{#if division == "in_person"}}Pencils{{/if}}', ctx)).toBe('Zoom');
    expect(render('{{#if award}}You won {{award}}{{/if}}.', ctx)).toBe('.');
  });
  it('leaves unknown variables visible instead of blank', () => {
    expect(render('Hi {{contact.first_name}}', ctx)).toBe('Hi {{contact.first_name}}');
    expect(missingVars('Hi {{contact.first_name}}, {{team.name}}', ctx)).toEqual(['contact.first_name']);
  });
});
