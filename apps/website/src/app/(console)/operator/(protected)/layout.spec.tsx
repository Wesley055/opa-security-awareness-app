// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOperatorContext: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('@/lib/operator-context', () => ({
  getOperatorContext: mocks.getOperatorContext,
}));

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import OperatorShellLayout from './layout';

const facility = {
  id: 'facility-1',
  name: 'Ikeja Gardens',
  type: 'GATED_ESTATE',
  isActive: true,
  isVerified: true,
};

describe('OperatorShellLayout role-aware Viewer navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows only Residents navigation for FACILITY_ADMIN', async () => {
    mocks.getOperatorContext.mockResolvedValue({
      state: 'READY',
      context: {
        userId: 'admin-1',
        firstName: 'Ada',
        lastName: 'Admin',
        role: 'FACILITY_ADMIN',
        facility,
      },
    });

    render(await OperatorShellLayout({ children: <div>body</div> }));

    expect(screen.getByText('Viewer')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Residents' })).toHaveAttribute(
      'href',
      '/operator/residents',
    );
    expect(screen.queryByRole('link', { name: 'Incidents' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Members' })).toBeNull();
  });

  it('preserves Incidents and Members navigation for FACILITY_OPERATOR', async () => {
    mocks.getOperatorContext.mockResolvedValue({
      state: 'READY',
      context: {
        userId: 'operator-1',
        firstName: 'Ola',
        lastName: 'Operator',
        role: 'FACILITY_OPERATOR',
        facility,
      },
    });

    render(await OperatorShellLayout({ children: <div>body</div> }));

    expect(screen.getByRole('link', { name: 'Incidents' })).toHaveAttribute(
      'href',
      '/operator',
    );
    expect(screen.getByRole('link', { name: 'Members' })).toHaveAttribute(
      'href',
      '/operator/members',
    );
    expect(screen.queryByRole('link', { name: 'Residents' })).toBeNull();
  });

  it('does not expose facility navigation to a platform ADMIN', async () => {
    mocks.getOperatorContext.mockResolvedValue({
      state: 'NO_FACILITY',
      role: 'ADMIN',
    });

    render(await OperatorShellLayout({ children: <div>body</div> }));

    expect(screen.queryByRole('link', { name: 'Incidents' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Members' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Residents' })).toBeNull();
  });
});
