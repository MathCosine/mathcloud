import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/icons';
import { ArtProblems, ArtSheets, ArtStudents, ArtTeams } from './import/shared';
import { TeamsImport } from './import/TeamsImport';
import { StudentsImport } from './import/StudentsImport';
import { ProblemsImport } from './import/ProblemsImport';
import { SheetsImport } from './import/SheetsImport';
import '../../styles/import.css';

type Kind = 'teams' | 'students' | 'problems' | 'sheets';

const KINDS: { key: Kind; title: string; art: ReactNode; text: string; cols: string; sub: string }[] = [
  {
    key: 'teams', title: 'Teams with students', art: <ArtTeams />,
    text: 'Teams who signed up somewhere else: a Google Form, your own site, a coach’s spreadsheet.',
    cols: 'Team, school, in person or online, contact, students', sub: 'Teams who registered elsewhere, with their students',
  },
  {
    key: 'students', title: 'Students into existing teams', art: <ArtStudents />,
    text: 'A coach sends the names later. Each student joins the team’s next free letter.',
    cols: 'Team code or name, student, grade, guardian', sub: 'Students for teams that are already registered',
  },
  {
    key: 'problems', title: 'Problems and answer keys', art: <ArtProblems />,
    text: 'A round’s problems from a spreadsheet, or pasted as text with an Answer line under each.',
    cols: 'Number, text with $maths$, answers, points', sub: 'Problems and keys for one round',
  },
  {
    key: 'sheets', title: 'Paper answer sheets', art: <ArtSheets />,
    text: 'Sheets keyed in a spreadsheet instead of on the Grading screen.',
    cols: 'ID, then one column per problem', sub: 'Answer sheets keyed in a spreadsheet',
  },
];

export function Import() {
  const [params, setParams] = useSearchParams();
  const kind = KINDS.find((k) => k.key === params.get('type'));
  const round = params.get('round') ?? undefined;
  const choose = (k: Kind | null) => setParams(k ? { type: k } : {});

  return (
    <div className="stack-lg imp">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          {kind && (
            <button className="linkbtn small imp-back" type="button" onClick={() => choose(null)}><Icon name="back" size={14} />All imports</button>
          )}
          <h1 className="page-title">{kind ? `Import ${kind.title.toLowerCase()}` : 'Import'}</h1>
          <p className="page-sub">{kind ? kind.sub : 'Bring in a CSV with any columns. You match them up and see every row before anything is saved.'}</p>
        </div>
      </div>

      {!kind ? (
        <div className="imp-pick" role="list">
          {KINDS.map((k) => (
            <button key={k.key} type="button" role="listitem" className="imp-card" onClick={() => choose(k.key)}>
              <span className="imp-art">{k.art}</span>
              <span className="stack" style={{ gap: 4 }}>
                <b>{k.title}</b>
                <span className="soft small">{k.text}</span>
                <span className="tiny muted">Columns: {k.cols}</span>
              </span>
              <span className="imp-go"><Icon name="arrow" size={16} /></span>
            </button>
          ))}
        </div>
      ) : kind.key === 'teams' ? <TeamsImport />
        : kind.key === 'students' ? <StudentsImport />
          : kind.key === 'problems' ? <ProblemsImport initialRound={round} />
            : <SheetsImport initialRound={round} />}
    </div>
  );
}
