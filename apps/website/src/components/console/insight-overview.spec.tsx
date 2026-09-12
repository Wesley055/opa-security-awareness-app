import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { InsightOverview } from './insight-overview';
describe('Insight overview', () => {
  it('renders four explainable views and preserves unknown and delivery distinctions', () => {
    render(<InsightOverview result={{ state: 'READY', summary: { incidentCount: 2, unresolved: 1, staleUnresolved: 1,
      resolutionMeanMs: 60000, acknowledgementMeanMs: null, evidencePresent: 3, evidencePossible: 10,
      missingEvidence: 1, overdueActions: 1, confirmedDelivered: 0, providerAccepted: 2 } }} />);
    for (const title of ['Executive', 'Operations', 'Risk', 'Evidence']) expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByText('UNKNOWN')).toBeInTheDocument();
    expect(screen.getByText('Provider accepted, unconfirmed')).toBeInTheDocument();
    expect(screen.getByText('Confirmed delivered')).toBeInTheDocument();
    expect(screen.getByText('3 / 10')).toBeInTheDocument();
  });
  it('does not turn unavailable data into zero counts', () => {
    render(<InsightOverview result={{ state: 'UNAVAILABLE' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('temporarily unavailable');
    expect(screen.queryByText('Incidents')).not.toBeInTheDocument();
  });
});
