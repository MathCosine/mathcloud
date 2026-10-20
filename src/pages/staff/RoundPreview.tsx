import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useContest } from '../../lib/hooks';
import type { Problem } from '../../lib/model';
import { useUser } from '../../lib/session';
import { Icon } from '../../components/icons';
import { EmptyState, Segmented } from '../../components/ui';
import { ExamSim } from '../student/ExamSim';
import '../../styles/practice.css';

/**
 * A round's test as a student sees it, for organisers: the real problems in
 * the real screens, the honour code, the clock, the integrity notices and
 * the marking at the end. It runs in the browser only (see ExamSim): no
 * attempt is created and nothing is written, in the sandbox or connected.
 */
export function RoundPreview() {
  const { roundId } = useParams();
  const user = useUser()!;
  const contest = useContest();
  const navigate = useNavigate();
  const [short, setShort] = useState(false);
  const round = contest.rounds.find((r) => r.id === roundId);
  const back = round ? `/staff/problems?round=${round.id}` : '/staff/problems';
  // Only Guts hands out sets; elsewhere a set number means nothing to a student.
  const problems = useMemo<Problem[]>(
    () => (!round ? [] : round.kind === 'guts' ? round.problems : round.problems.map((p) => ({ ...p, set: undefined }))),
    [round],
  );

  const head = (sub: string) => (
    <div className="page-head">
      <div>
        <h1 className="page-title">Preview{round ? `: ${round.name}` : ''}</h1>
        <p className="page-sub">{sub}</p>
      </div>
      <div className="actions">
        <Link className="btn" to={back}><Icon name="back" />Back to problems</Link>
      </div>
    </div>
  );

  if (user.role !== 'director' && user.role !== 'staff') {
    return (
      <div>
        {head('Previews are for organisers.')}
        <EmptyState className="pv-empty" icon="lock" title="Only organisers can preview tests">Ask a director if you need to see a round before the day.</EmptyState>
      </div>
    );
  }
  if (!round) {
    return (
      <div>
        {head(`No round with this address in ${contest.short}.`)}
        <EmptyState className="pv-empty" icon="rounds" title="This round is not here" action={<Link className="btn btn-primary" to="/staff/problems">Go to problems</Link>}>It may have been removed, or it belongs to another contest.</EmptyState>
      </div>
    );
  }

  const count = round.problems.length;
  return (
    <div className="pv">
      {head(count ? `${count} ${count === 1 ? 'problem' : 'problems'}, ${round.minutes} minutes, exactly as a student sees them. Nothing is saved.` : 'Nothing to preview yet.')}
      <div className="pv-tools">
        {contest.rounds.length > 1 && (
          <span className="pv-tool">
            <span className="label">Round</span>
            <Segmented label="Round" value={round.id} onChange={(id) => navigate(`/staff/preview/${id}`)} items={contest.rounds.map((r) => ({ key: r.id, label: r.name }))} />
          </span>
        )}
        {count > 0 && (
          <span className="pv-tool" title="A short clock lets you see what happens when time runs out">
            <span className="label">Clock</span>
            <Segmented label="Clock" value={short ? 'short' : 'real'} onChange={(k) => setShort(k === 'short')} items={[{ key: 'real', label: `${round.minutes} min` }, { key: 'short', label: '2 min' }]} />
          </span>
        )}
      </div>
      {count === 0 ? (
        <EmptyState
          className="pv-empty"
          icon="sigma"
          title={`${round.name} has no problems yet`}
          action={<Link className="btn btn-primary" to={back}><Icon name="plus" />Add problems</Link>}
        >
          Add them on the Problems page, then come back to take the test as a student would.
        </EmptyState>
      ) : (
        <ExamSim
          key={`${round.id}:${short}`}
          inline
          title={round.name}
          context={contest.short}
          minutes={short ? 2 : round.minutes}
          kind={round.kind}
          problems={problems}
          rules={round.rules}
          integrity={round.integrity}
          freezeMinutes={contest.board.freezeMinutes}
          name={user.name}
          who={`${user.name} · preview`}
          audience="organiser"
          exit={{ label: 'Back to problems', to: back }}
          ribbon={
            <>
              <span className="ps-ribbon-t"><Icon name="eye" size={14} /><span><b>Preview:</b> <span className="ps-wide">you’re seeing the test as a student would. </span>Nothing is saved.</span></span>
              <Link to={back}>Back to problems</Link>
            </>
          }
        />
      )}
    </div>
  );
}
