import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Onboarding, { PRIVACY_POLICY_URL } from './Onboarding';

const chromeMock = {
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
    },
    onChanged: {
      addListener: vi.fn(),
    },
  },
  runtime: {
    openOptionsPage: vi.fn(),
  },
};

global.chrome = chromeMock as unknown as typeof chrome;

async function mount(stored: Record<string, unknown> = {}) {
  chromeMock.storage.local.get.mockImplementation((_keys: unknown, callback: (items: Record<string, unknown>) => void) => {
    callback(stored);
  });
  chromeMock.storage.local.set.mockImplementation((_items: unknown, callback: () => void) => {
    callback();
  });
  await act(async () => {
    render(<Onboarding />);
  });
}

describe('Onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the three mode cards with Balanced preselected', async () => {
    await mount();
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((r) => r.value)).toEqual(['private', 'balanced', 'everything']);
    expect(radios.map((r) => r.checked)).toEqual([false, true, false]);
    expect(screen.getByRole('radio', { name: /Balanced \(recommended\)/ })).toBeInTheDocument();
  });

  it('describes each mode in the same sentence the options page uses', async () => {
    await mount();
    expect(screen.getByText(/Nothing leaves your browser until you hover/)).toBeInTheDocument();
    expect(screen.getByText(/sent to the Legible Links server only while you hover it/)).toBeInTheDocument();
    expect(screen.getByText(/every other public link is sent to the Legible Links server automatically/)).toBeInTheDocument();
  });

  it('says what the extension does, with a before/after example', async () => {
    await mount();
    expect(screen.getByText(/turns raw URLs in link text into readable titles and always shows where the link goes/)).toBeInTheDocument();
    expect(screen.getByText('https://youtu.be/dQw4w9WgXcQ')).toBeInTheDocument();
    expect(screen.getByText('Rick Astley - Never Gonna Give You Up')).toBeInTheDocument();
    expect(screen.getByText(/youtube\.com/)).toBeInTheDocument();
  });

  it('Continue saves the preselected Balanced preset and onboarded: true, then confirms', async () => {
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });
    expect(chromeMock.storage.local.set).toHaveBeenCalledTimes(1);
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith(
      { platformMode: 'auto', genericMode: 'hover', onboarded: true },
      expect.any(Function),
    );
    expect(screen.getByRole('status')).toHaveTextContent(/You're set/);
    expect(screen.getByRole('status')).toHaveTextContent(/Balanced mode/);
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('Continue saves the chosen card: Private', async () => {
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: /Private/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith(
      { platformMode: 'hover', genericMode: 'off', onboarded: true },
      expect.any(Function),
    );
    expect(screen.getByRole('status')).toHaveTextContent(/Private mode/);
  });

  it('Continue saves the chosen card: Everything', async () => {
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: /Everything/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith(
      { platformMode: 'auto', genericMode: 'auto', onboarded: true },
      expect.any(Function),
    );
  });

  it('nothing is saved until Continue is pressed', async () => {
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: /Everything/ }));
    });
    expect(chromeMock.storage.local.set).not.toHaveBeenCalled();
  });

  it('preselects the mode already in force when revisited', async () => {
    await mount({ platformMode: 'hover', genericMode: 'off' });
    expect((screen.getByRole('radio', { name: /Private/ }) as HTMLInputElement).checked).toBe(true);
  });

  it('links to the privacy policy and opens the options page', async () => {
    await mount();
    const policy = screen.getByRole('link', { name: 'Privacy policy' });
    expect(policy).toHaveAttribute('href', PRIVACY_POLICY_URL);
    expect(policy).toHaveAttribute('rel', 'noreferrer');
    fireEvent.click(screen.getByRole('button', { name: 'All settings' }));
    expect(chromeMock.runtime.openOptionsPage).toHaveBeenCalledTimes(1);
  });
});
